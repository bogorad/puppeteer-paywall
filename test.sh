export EXECUTABLE_PATH=/usr/lib/chromium/chromium
export EXTENSION_PATHS="/home/chuck/git/puppeteer-paywall/I-Still-Dont-Care-About-Cookies/src,/home/chuck/git/puppeteer-paywall/bypass-paywalls-chrome-clean-master,/home/chuck/git/puppeteer-paywall/uBOL-home/chromium"
export PORT=5556
xvfb-run -a node ./server-optimus.js
