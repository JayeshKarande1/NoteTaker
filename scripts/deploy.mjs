import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';

console.log('Building Stillnote for GitHub Pages...');
execSync('npm run build', { stdio: 'inherit', env: { ...process.env, GITHUB_ACTIONS: 'true' } });

console.log('Pushing to gh-pages branch...');
execSync('git init', { cwd: 'dist', stdio: 'inherit' });
execSync('git config user.name "Jayesh Karande"', { cwd: 'dist', stdio: 'inherit' });
execSync('git config user.email "66314983+JayeshKarande1@users.noreply.github.com"', { cwd: 'dist', stdio: 'inherit' });
execSync('git checkout -b gh-pages', { cwd: 'dist', stdio: 'inherit' });
execSync('git add -A', { cwd: 'dist', stdio: 'inherit' });
execSync('git commit -m "deploy: GitHub Pages build"', { cwd: 'dist', stdio: 'inherit' });
execSync('git remote add origin https://github.com/JayeshKarande1/NoteTaker.git', { cwd: 'dist', stdio: 'inherit' });
execSync('git push -f origin gh-pages', { cwd: 'dist', stdio: 'inherit' });
rmSync('dist/.git', { recursive: true, force: true });
console.log('Successfully deployed to https://JayeshKarande1.github.io/NoteTaker/');
