gulp rename-images
gulp resize-images
gulp delete

git checkout --orphan tmp
git add -A
git commit -m "upload"
git branch -D master
git branch -m master
git push -f origin master