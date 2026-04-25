@echo off
echo Initializing Git repository...
git init

echo Adding files...
git add .

echo Committing files...
git commit -m "Deploy ConvertX to GitHub Pages"

echo Setting main branch...
git branch -M main

echo Adding remote origin...
:: We use 2>nul to ignore the error if the remote already exists
git remote add origin https://github.com/naivedyamishra326-hash/convertx-.git 2>nul

echo Pushing to GitHub...
git push -u origin main

echo.
echo ========================================================
echo Done! Your code has been pushed to GitHub.
echo.
echo NEXT STEPS:
echo 1. Go to https://github.com/naivedyamishra326-hash/convertx-/settings/pages
echo 2. Under "Build and deployment" -^> "Source", select "Deploy from a branch".
echo 3. Select the "main" branch and "/ (root)" folder, then click Save.
echo ========================================================
pause
