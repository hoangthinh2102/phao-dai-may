#!/bin/sh
# Build dist/ for static hosting (Vercel). index.html is written for Claude Artifacts, which add the
# <!doctype>/<head> skeleton at publish time, so we add the same skeleton here.
set -e
cd "$(dirname "$0")/.."
rm -rf dist
mkdir -p dist/js
cp js/*.js dist/js/
mkdir -p dist/assets && cp assets/*.png dist/assets/
# painted art for the 3D view (heroes, weapons, decor, skies, terrain detail)
mkdir -p dist/art && cp art/art.json art/*.webp dist/art/
# build id: open pages poll version.json and reload themselves (outside rooms and matches) when it changes
BUILD=$(date +%s)
printf '{"v":"%s"}\n' "$BUILD" > dist/version.json
{
  printf '<!doctype html>\n<html lang="vi">\n<head>\n<meta charset="utf-8">\n'
  printf '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">\n'
  printf '<meta name="theme-color" content="#3d8ef0">\n<meta name="mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-capable" content="yes">\n'
  printf '<meta name="description" content="Pháo Đài Mây: bắn tọa độ theo lượt kiểu Gunny, chơi theo đội 1v1 đến 3v3.">\n'
  printf '<link rel="icon" href="data:image/svg+xml,%%3Csvg xmlns=%%27http://www.w3.org/2000/svg%%27 viewBox=%%270 0 100 100%%27%%3E%%3Ctext y=%%27.9em%%27 font-size=%%2790%%27%%3E%%E2%%98%%81%%EF%%B8%%8F%%3C/text%%3E%%3C/svg%%3E">\n'
  printf '<style>*,*::before,*::after{box-sizing:border-box}body{margin:0}</style>\n'
  printf '<script>window.PDM_BUILD="%s"</script>\n</head>\n<body>\n' "$BUILD"
  cat index.html
  printf '\n</body>\n</html>\n'
} > dist/index.html
echo "built dist/"
