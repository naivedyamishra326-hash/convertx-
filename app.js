/* ═══════════════════════════════════════════════
   ConvertX — App Logic (FFmpeg.wasm)
   Fixed & Enhanced with Bulk Conversion
   ═══════════════════════════════════════════════ */

(() => {
    'use strict';

    // ── DOM References ──────────────────────────
    const dropzone        = document.getElementById('dropzone');
    const fileInput       = document.getElementById('file-input');
    const fileQueuePanel  = document.getElementById('file-queue-panel');
    const fileListEl      = document.getElementById('file-list');
    const btnAddMore      = document.getElementById('btn-add-more');
    const btnClearAll     = document.getElementById('btn-clear-all');
    const btnConvert      = document.getElementById('btn-convert');
    const btnConvertText  = document.getElementById('btn-convert-text');
    const btnConvertSpin  = document.getElementById('btn-convert-spinner');
    const qualitySelect   = document.getElementById('output-quality');
    const resolutionSelect = document.getElementById('output-resolution');
    const donePanel       = document.getElementById('done-panel');
    const doneTitle       = document.getElementById('done-title');
    const doneSubtitle    = document.getElementById('done-subtitle');
    const doneFileList    = document.getElementById('done-file-list');
    const btnDownloadAll  = document.getElementById('btn-download-all');
    const btnAnother      = document.getElementById('btn-another');
    const errorPanel      = document.getElementById('error-panel');
    const errorDetail     = document.getElementById('error-detail');
    const btnRetry        = document.getElementById('btn-retry');
    const particlesCanvas = document.getElementById('particles-canvas');

    // ── State ───────────────────────────────────
    /** @type {{ id: string, file: File, status: string, progress: number, outputBlob: Blob|null, outputName: string, error: string|null }[]} */
    let fileQueue = [];
    let ffmpegInstance = null;
    let ffmpegLoaded = false;
    let isConverting = false;
    let nextId = 0;

    // ── Allowed MIME types and extensions ───────
    const ALLOWED_EXTENSIONS = new Set([
        'mov', 'mp4', 'mkv', 'avi', 'webm', 'h264', '264',
        'ts', 'm2ts', 'm4v', '3gp', 'flv', 'wmv', 'mpeg',
        'mpg', 'ogv', 'mts'
    ]);

    const ALLOWED_MIME_PREFIXES = ['video/'];

    // ── Inline fetchFile ────────────────────────
    // FIX: The original code relied on @ffmpeg/util which uses CommonJS
    // require() and fails in the browser. This inline version handles
    // File/Blob/URL/base64 inputs correctly.
    async function fetchFile(file) {
        if (typeof file === 'string') {
            if (/^data:/.test(file)) {
                const raw = atob(file.split(',')[1]);
                const arr = new Uint8Array(raw.length);
                for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
                return arr;
            }
            const resp = await fetch(file);
            return new Uint8Array(await resp.arrayBuffer());
        }
        if (file instanceof File || file instanceof Blob) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(new Uint8Array(reader.result));
                reader.onerror = () => reject(new Error('Failed to read file'));
                reader.readAsArrayBuffer(file);
            });
        }
        return new Uint8Array();
    }

    // ── Particles ───────────────────────────────
    function initParticles() {
        const ctx = particlesCanvas.getContext('2d');
        let particles = [];
        const PARTICLE_COUNT = 50;

        function resize() {
            particlesCanvas.width  = window.innerWidth;
            particlesCanvas.height = window.innerHeight;
        }
        resize();
        window.addEventListener('resize', resize);

        for (let i = 0; i < PARTICLE_COUNT; i++) {
            particles.push({
                x: Math.random() * particlesCanvas.width,
                y: Math.random() * particlesCanvas.height,
                r: Math.random() * 1.5 + 0.3,
                dx: (Math.random() - 0.5) * 0.3,
                dy: (Math.random() - 0.5) * 0.3,
                opacity: Math.random() * 0.4 + 0.1,
            });
        }

        function draw() {
            ctx.clearRect(0, 0, particlesCanvas.width, particlesCanvas.height);
            for (const p of particles) {
                p.x += p.dx;
                p.y += p.dy;
                if (p.x < 0) p.x = particlesCanvas.width;
                if (p.x > particlesCanvas.width) p.x = 0;
                if (p.y < 0) p.y = particlesCanvas.height;
                if (p.y > particlesCanvas.height) p.y = 0;

                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(167, 139, 250, ${p.opacity})`;
                ctx.fill();
            }
            requestAnimationFrame(draw);
        }
        draw();
    }
    initParticles();

    // ── Utility ─────────────────────────────────
    function formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function getExtension(name) {
        const parts = name.split('.');
        return parts.length > 1 ? parts.pop().toLowerCase() : '';
    }

    function isValidVideoFile(file) {
        // Check extension
        const ext = getExtension(file.name);
        if (ext && ALLOWED_EXTENSIONS.has(ext)) return true;

        // FIX: MOV files sometimes have MIME type '' or 'application/octet-stream'
        // on some browsers/OS. We accept them by extension check above.
        // Also check MIME type prefix.
        if (file.type) {
            for (const prefix of ALLOWED_MIME_PREFIXES) {
                if (file.type.startsWith(prefix)) return true;
            }
        }

        return false;
    }

    function showPanel(panel) {
        [dropzone, fileQueuePanel, donePanel, errorPanel].forEach(p => {
            p.style.display = 'none';
        });
        panel.style.display = '';
    }

    function generateId() {
        return 'file-' + (nextId++);
    }

    // ── File Queue Rendering ────────────────────
    function renderFileList() {
        fileListEl.innerHTML = '';
        const count = fileQueue.length;
        btnConvertText.textContent = count === 1
            ? 'Convert to MP4'
            : `Convert All ${count} Files to MP4`;

        fileQueue.forEach(item => {
            const row = document.createElement('div');
            row.className = `file-row file-row--${item.status}`;
            row.id = `row-${item.id}`;

            // Status icon
            let statusIcon = '';
            switch(item.status) {
                case 'queued':
                    statusIcon = `<div class="file-row-status status-queued" title="Queued">
                        <svg viewBox="0 0 20 20" fill="currentColor"><circle cx="10" cy="10" r="6" opacity="0.4"/></svg>
                    </div>`;
                    break;
                case 'processing':
                    statusIcon = `<div class="file-row-status status-processing" title="Processing">
                        <svg viewBox="0 0 24 24" fill="none">
                            <circle cx="12" cy="12" r="10" stroke="rgba(167,139,250,0.2)" stroke-width="2.5"/>
                            <path d="M12 2a10 10 0 0110 10" stroke="#a78bfa" stroke-width="2.5" stroke-linecap="round" class="spinner-arc"/>
                        </svg>
                    </div>`;
                    break;
                case 'done':
                    statusIcon = `<div class="file-row-status status-done" title="Done">
                        <svg viewBox="0 0 20 20" fill="#34d399"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd"/></svg>
                    </div>`;
                    break;
                case 'failed':
                    statusIcon = `<div class="file-row-status status-failed" title="${item.error || 'Failed'}">
                        <svg viewBox="0 0 20 20" fill="#f43f5e"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clip-rule="evenodd"/></svg>
                    </div>`;
                    break;
            }

            // Progress bar for active item
            let progressHtml = '';
            if (item.status === 'processing') {
                progressHtml = `<div class="file-row-progress-wrap">
                    <div class="file-row-progress" id="progress-${item.id}" style="width:${item.progress}%"></div>
                </div>
                <span class="file-row-percent" id="percent-${item.id}">${item.progress}%</span>`;
            } else if (item.status === 'done' && item.outputBlob) {
                progressHtml = `<span class="file-row-result">${formatBytes(item.outputBlob.size)}</span>`;
            } else if (item.status === 'failed') {
                progressHtml = `<span class="file-row-error">${item.error || 'Error'}</span>`;
            }

            row.innerHTML = `
                ${statusIcon}
                <div class="file-row-info">
                    <p class="file-row-name" title="${item.file.name}">${item.file.name}</p>
                    <p class="file-row-size">${formatBytes(item.file.size)}</p>
                </div>
                <div class="file-row-mid">${progressHtml}</div>
                ${item.status === 'queued' ? `<button class="btn-remove-row" data-id="${item.id}" title="Remove">
                    <svg viewBox="0 0 20 20" fill="currentColor"><path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"/></svg>
                </button>` : ''}
                ${item.status === 'done' && item.outputBlob ? `<button class="btn-download-row" data-id="${item.id}" title="Download">
                    <svg viewBox="0 0 20 20" fill="currentColor"><path d="M10 3a.75.75 0 01.75.75v7.69l2.72-2.72a.75.75 0 111.06 1.06l-4 4a.75.75 0 01-1.06 0l-4-4a.75.75 0 011.06-1.06l2.72 2.72V3.75A.75.75 0 0110 3z"/><path d="M3 15.75a.75.75 0 01.75-.75h12.5a.75.75 0 010 1.5H3.75a.75.75 0 01-.75-.75z"/></svg>
                </button>` : ''}
            `;

            fileListEl.appendChild(row);
        });

        // Attach remove handlers
        fileListEl.querySelectorAll('.btn-remove-row').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                fileQueue = fileQueue.filter(f => f.id !== id);
                if (fileQueue.length === 0) {
                    showPanel(dropzone);
                } else {
                    renderFileList();
                }
            });
        });

        // Attach individual download handlers
        fileListEl.querySelectorAll('.btn-download-row').forEach(btn => {
            btn.addEventListener('click', () => {
                const item = fileQueue.find(f => f.id === btn.dataset.id);
                if (item && item.outputBlob) {
                    downloadBlob(item.outputBlob, item.outputName);
                }
            });
        });
    }

    // ── Update a single row's progress (no full re-render) ──
    function updateRowProgress(id, progress) {
        const bar = document.getElementById(`progress-${id}`);
        const pct = document.getElementById(`percent-${id}`);
        if (bar) bar.style.width = progress + '%';
        if (pct) pct.textContent = progress + '%';
    }

    // ── File Selection ──────────────────────────
    dropzone.addEventListener('click', () => fileInput.click());
    btnAddMore.addEventListener('click', () => fileInput.click());

    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('drag-over');
    });

    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('drag-over');
    });

    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('drag-over');
        handleFiles(Array.from(e.dataTransfer.files));
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) {
            handleFiles(Array.from(fileInput.files));
            fileInput.value = ''; // Reset so same files can be re-added
        }
    });

    function handleFiles(files) {
        let invalidCount = 0;

        files.forEach(file => {
            // FIX: MOV files are sometimes reported as 'application/octet-stream'
            // or have no MIME type. We check by extension as a fallback.
            if (!isValidVideoFile(file)) {
                invalidCount++;
                return;
            }

            // Avoid duplicates by name+size
            const isDup = fileQueue.some(
                q => q.file.name === file.name && q.file.size === file.size
            );
            if (isDup) return;

            fileQueue.push({
                id: generateId(),
                file,
                status: 'queued',
                progress: 0,
                outputBlob: null,
                outputName: file.name.replace(/\.[^.]+$/, '') + '.mp4',
                error: null,
            });
        });

        if (invalidCount > 0) {
            showToast(`${invalidCount} file${invalidCount > 1 ? 's' : ''} skipped — not a supported video format.`);
        }

        if (fileQueue.length > 0) {
            showPanel(fileQueuePanel);
            renderFileList();
        }
    }

    btnClearAll.addEventListener('click', () => {
        if (isConverting) return;
        fileQueue = [];
        showPanel(dropzone);
    });

    // ── Toast Notifications ─────────────────────
    function showToast(message, duration = 4000) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        document.body.appendChild(toast);
        // Trigger animation
        requestAnimationFrame(() => toast.classList.add('toast-visible'));
        setTimeout(() => {
            toast.classList.remove('toast-visible');
            toast.addEventListener('transitionend', () => toast.remove());
        }, duration);
    }

    // ── FFmpeg Loading ──────────────────────────
    // Loads everything from CDN as Blob URLs to completely bypass
    // CORS, COEP, hardcoded paths, and caching issues on GitHub Pages.

    async function toBlobURL(url, mimeType) {
        const response = await fetch(url);
        const buf = await response.arrayBuffer();
        const blob = new Blob([buf], { type: mimeType });
        return URL.createObjectURL(blob);
    }

    async function loadFFmpeg() {
        if (ffmpegLoaded && ffmpegInstance) return ffmpegInstance;

        if (typeof FFmpegWASM === 'undefined') {
            throw new Error(
                'FFmpeg library not loaded. Make sure ffmpeg.js is included.'
            );
        }

        const { FFmpeg } = FFmpegWASM;
        const ffmpeg = new FFmpeg();

        ffmpeg.on('log', ({ message }) => {
            console.log('[FFmpeg]', message);
        });

        ffmpeg.on('progress', ({ progress }) => {
            const pct = Math.min(Math.round(progress * 100), 100);
            const active = fileQueue.find(f => f.status === 'processing');
            if (active) {
                active.progress = pct;
                updateRowProgress(active.id, pct);
            }
        });

        // Load ALL ffmpeg files from CDN as Blob URLs
        const CORE_CDN = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd';

        console.log('[ConvertX] Loading FFmpeg core from CDN...');
        const coreURL = await toBlobURL(`${CORE_CDN}/ffmpeg-core.js`, 'text/javascript');
        const wasmURL = await toBlobURL(`${CORE_CDN}/ffmpeg-core.wasm`, 'application/wasm');

        await ffmpeg.load({ coreURL, wasmURL });
        console.log('[ConvertX] ✅ FFmpeg loaded successfully');

        ffmpegInstance = ffmpeg;
        ffmpegLoaded = true;
        return ffmpeg;
    }

    // ── Bulk Conversion (Queue System) ──────────
    // BULK CONVERSION LOGIC: Files are processed sequentially to avoid
    // memory issues. Each file gets its own progress tracking.
    btnConvert.addEventListener('click', startBulkConversion);

    async function startBulkConversion() {
        if (isConverting) return;
        if (fileQueue.length === 0) return;

        isConverting = true;
        btnConvert.disabled = true;
        btnConvertText.textContent = 'Converting…';
        btnConvertSpin.style.display = 'inline-flex';
        btnClearAll.disabled = true;
        btnAddMore.disabled = true;

        // Disable settings during conversion
        qualitySelect.disabled = true;
        resolutionSelect.disabled = true;

        try {
            const ffmpeg = await loadFFmpeg();

            // Process each file sequentially
            for (const item of fileQueue) {
                if (item.status !== 'queued') continue;

                item.status = 'processing';
                item.progress = 0;
                renderFileList();

                try {
                    await convertSingleFile(ffmpeg, item);
                    item.status = 'done';
                } catch (err) {
                    console.error(`Conversion error for ${item.file.name}:`, err);
                    item.status = 'failed';
                    item.error = err.message || 'Conversion failed';
                }

                renderFileList();
            }

            // Check results
            const doneCount = fileQueue.filter(f => f.status === 'done').length;
            const failedCount = fileQueue.filter(f => f.status === 'failed').length;

            if (doneCount > 0) {
                // Show done panel
                doneTitle.textContent = failedCount > 0
                    ? `${doneCount} of ${fileQueue.length} Conversions Complete`
                    : doneCount === 1
                        ? 'Conversion Complete!'
                        : `All ${doneCount} Conversions Complete!`;

                const totalSize = fileQueue
                    .filter(f => f.status === 'done' && f.outputBlob)
                    .reduce((sum, f) => sum + f.outputBlob.size, 0);
                doneSubtitle.textContent = `Total output: ${formatBytes(totalSize)}`;

                renderDoneFileList();
                showPanel(donePanel);
            } else {
                errorDetail.textContent = 'All files failed to convert. Check that your files are valid video files.';
                showPanel(errorPanel);
            }

        } catch (err) {
            console.error('Bulk conversion error:', err);
            errorDetail.textContent = err.message || 'Failed to initialize FFmpeg.';
            showPanel(errorPanel);
        } finally {
            isConverting = false;
            btnConvert.disabled = false;
            btnConvertSpin.style.display = 'none';
            btnClearAll.disabled = false;
            btnAddMore.disabled = false;
            qualitySelect.disabled = false;
            resolutionSelect.disabled = false;
        }
    }

    // ── Smart conversion: "Auto" tries copy first, then re-encodes ──
    // MOV and MP4 are both containers for H.264/AAC, so stream copy
    // (remuxing) is nearly instant. Re-encoding is 100-500x slower
    // in WebAssembly. Auto mode tries copy first for maximum speed.

    async function convertSingleFile(ffmpeg, item) {
        const ext = getExtension(item.file.name) || 'mov';
        const safeExt = ext.replace(/[^a-z0-9]/g, '');
        const inputName = `input_${item.id}.${safeExt || 'mov'}`;
        const outputFileName = `output_${item.id}.mp4`;

        // Read file into FFmpeg's virtual filesystem
        const fileData = await fetchFile(item.file);
        await ffmpeg.writeFile(inputName, fileData);

        const quality = qualitySelect.value;
        const resolution = resolutionSelect.value;

        // ── AUTO MODE: Try stream copy first (instant), fallback to re-encode ──
        if (quality === 'auto') {
            console.log(`[ConvertX] AUTO mode: trying stream copy for ${item.file.name}...`);

            // Attempt 1: Stream copy (nearly instant)
            const copyArgs = [
                '-i', inputName,
                '-c', 'copy',
                '-movflags', '+faststart',
                '-y', outputFileName
            ];

            const copyResult = await ffmpeg.exec(copyArgs);

            // Check if copy produced valid output
            let copySuccess = false;
            try {
                const copyData = await ffmpeg.readFile(outputFileName);
                if (copyData && copyData.length > 1024) {
                    // Copy succeeded — use this output
                    console.log(`[ConvertX] ✅ Stream copy succeeded! (instant, ${formatBytes(copyData.length)})`);
                    item.outputBlob = new Blob([copyData.buffer], { type: 'video/mp4' });
                    item.outputName = item.file.name.replace(/\.[^.]+$/, '') + '.mp4';
                    copySuccess = true;
                }
            } catch (e) {
                console.log('[ConvertX] Stream copy output unreadable, falling back to re-encode');
            }

            if (copySuccess) {
                // Cleanup
                try { await ffmpeg.deleteFile(inputName); } catch(e) {}
                try { await ffmpeg.deleteFile(outputFileName); } catch(e) {}
                return;
            }

            // Attempt 2: Re-encode with ultrafast preset
            console.log(`[ConvertX] Stream copy failed, falling back to ultrafast re-encode...`);
            // Need to re-write input if it was consumed
            try { await ffmpeg.deleteFile(outputFileName); } catch(e) {}

            const reencodeArgs = [
                '-i', inputName,
                '-c:v', 'libx264',
                '-preset', 'ultrafast',
                '-crf', '23',
                '-c:a', 'aac',
                '-b:a', '128k',
                '-movflags', '+faststart',
                '-pix_fmt', 'yuv420p',
                '-y', outputFileName
            ];

            if (resolution !== 'original') {
                reencodeArgs.splice(reencodeArgs.indexOf('-movflags'), 0, '-vf', `scale=-2:${resolution}`);
            }

            console.log(`[ConvertX] Re-encoding: ffmpeg ${reencodeArgs.join(' ')}`);
            await ffmpeg.exec(reencodeArgs);

            const data = await ffmpeg.readFile(outputFileName);
            if (!data || data.length === 0) {
                throw new Error('FFmpeg produced empty output — file may be corrupted or unsupported.');
            }

            item.outputBlob = new Blob([data.buffer], { type: 'video/mp4' });
            item.outputName = item.file.name.replace(/\.[^.]+$/, '') + '.mp4';

            try { await ffmpeg.deleteFile(inputName); } catch(e) {}
            try { await ffmpeg.deleteFile(outputFileName); } catch(e) {}
            return;
        }

        // ── COPY MODE: Just remux, no re-encoding ──
        if (quality === 'copy') {
            const args = [
                '-i', inputName,
                '-c', 'copy',
                '-movflags', '+faststart',
                '-y', outputFileName
            ];

            console.log(`[ConvertX] Copy mode: ffmpeg ${args.join(' ')}`);
            await ffmpeg.exec(args);

            const data = await ffmpeg.readFile(outputFileName);
            if (!data || data.length === 0) {
                throw new Error('Stream copy failed — codec may be incompatible with MP4. Try re-encode mode.');
            }

            item.outputBlob = new Blob([data.buffer], { type: 'video/mp4' });
            item.outputName = item.file.name.replace(/\.[^.]+$/, '') + '.mp4';

            try { await ffmpeg.deleteFile(inputName); } catch(e) {}
            try { await ffmpeg.deleteFile(outputFileName); } catch(e) {}
            return;
        }

        // ── RE-ENCODE MODE: Full transcoding ──
        const args = ['-i', inputName];

        // Use ultrafast preset — "fast" is too slow for WASM
        args.push('-c:v', 'libx264');
        args.push('-preset', 'ultrafast');

        if (quality === 'high') {
            args.push('-crf', '18');
        } else if (quality === 'medium') {
            args.push('-crf', '23');
        } else {
            args.push('-crf', '28');
        }

        args.push('-c:a', 'aac');
        args.push('-b:a', '128k');

        if (resolution !== 'original') {
            args.push('-vf', `scale=-2:${resolution}`);
        }

        args.push('-movflags', '+faststart');
        args.push('-pix_fmt', 'yuv420p');
        args.push('-y', outputFileName);

        console.log(`[ConvertX] Re-encoding ${item.file.name}: ffmpeg ${args.join(' ')}`);

        await ffmpeg.exec(args);

        // Read output
        const data = await ffmpeg.readFile(outputFileName);

        if (!data || data.length === 0) {
            throw new Error('FFmpeg produced empty output — file may be corrupted or unsupported.');
        }

        item.outputBlob = new Blob([data.buffer], { type: 'video/mp4' });
        item.outputName = item.file.name.replace(/\.[^.]+$/, '') + '.mp4';

        // Cleanup virtual FS to free memory
        try { await ffmpeg.deleteFile(inputName); } catch(e) {}
        try { await ffmpeg.deleteFile(outputFileName); } catch(e) {}
    }

    // ── Done panel file list ────────────────────
    function renderDoneFileList() {
        doneFileList.innerHTML = '';
        fileQueue.filter(f => f.status === 'done' && f.outputBlob).forEach(item => {
            const row = document.createElement('div');
            row.className = 'done-file-row';
            row.innerHTML = `
                <span class="done-file-name">${item.outputName}</span>
                <span class="done-file-size">${formatBytes(item.outputBlob.size)}</span>
                <button class="btn-download-sm" data-id="${item.id}">
                    <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M10 3a.75.75 0 01.75.75v7.69l2.72-2.72a.75.75 0 111.06 1.06l-4 4a.75.75 0 01-1.06 0l-4-4a.75.75 0 011.06-1.06l2.72 2.72V3.75A.75.75 0 0110 3z"/><path d="M3 15.75a.75.75 0 01.75-.75h12.5a.75.75 0 010 1.5H3.75a.75.75 0 01-.75-.75z"/></svg>
                </button>
            `;
            doneFileList.appendChild(row);
        });

        doneFileList.querySelectorAll('.btn-download-sm').forEach(btn => {
            btn.addEventListener('click', () => {
                const item = fileQueue.find(f => f.id === btn.dataset.id);
                if (item && item.outputBlob) {
                    downloadBlob(item.outputBlob, item.outputName);
                }
            });
        });
    }

    // ── Download Helpers ────────────────────────
    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    }

    // ── Download All as ZIP ─────────────────────
    // BULK FEATURE: Uses JSZip to package all converted files into a
    // single ZIP archive for convenient download.
    btnDownloadAll.addEventListener('click', async () => {
        const doneItems = fileQueue.filter(f => f.status === 'done' && f.outputBlob);

        if (doneItems.length === 0) return;

        // If only one file, just download it directly
        if (doneItems.length === 1) {
            downloadBlob(doneItems[0].outputBlob, doneItems[0].outputName);
            return;
        }

        // Multiple files → ZIP
        btnDownloadAll.disabled = true;
        btnDownloadAll.textContent = 'Creating ZIP…';

        try {
            if (typeof JSZip === 'undefined') {
                throw new Error('JSZip library not loaded.');
            }

            const zip = new JSZip();
            const usedNames = new Set();

            doneItems.forEach(item => {
                // Avoid duplicate names in ZIP
                let name = item.outputName;
                let counter = 1;
                while (usedNames.has(name)) {
                    name = item.outputName.replace('.mp4', `_${counter++}.mp4`);
                }
                usedNames.add(name);
                zip.file(name, item.outputBlob);
            });

            const zipBlob = await zip.generateAsync({
                type: 'blob',
                compression: 'STORE', // Videos are already compressed
            });

            downloadBlob(zipBlob, 'ConvertX_output.zip');
        } catch (err) {
            console.error('ZIP creation error:', err);
            showToast('Failed to create ZIP. Downloading files individually…');
            // Fallback: download individually
            doneItems.forEach(item => {
                downloadBlob(item.outputBlob, item.outputName);
            });
        } finally {
            btnDownloadAll.disabled = false;
            btnDownloadAll.innerHTML = `
                <svg viewBox="0 0 20 20" fill="currentColor"><path d="M10 3a.75.75 0 01.75.75v7.69l2.72-2.72a.75.75 0 111.06 1.06l-4 4a.75.75 0 01-1.06 0l-4-4a.75.75 0 011.06-1.06l2.72 2.72V3.75A.75.75 0 0110 3z"/><path d="M3 15.75a.75.75 0 01.75-.75h12.5a.75.75 0 010 1.5H3.75a.75.75 0 01-.75-.75z"/></svg>
                Download All as ZIP
            `;
        }
    });

    // ── Reset ───────────────────────────────────
    function resetApp() {
        // Free blob URLs
        fileQueue.forEach(item => {
            if (item.outputBlob) {
                item.outputBlob = null;
            }
        });
        fileQueue = [];
        fileInput.value = '';
        showPanel(dropzone);
    }

    btnAnother.addEventListener('click', resetApp);
    btnRetry.addEventListener('click', resetApp);

})();
