const puppeteer = require("puppeteer");

class runTasks {

    constructor() {
    }

    static async getWebData(scriptContext) {
        try {
            let {url, selector} = scriptContext
            const browser = await puppeteer.launch({
                headless: true,
                args: [
                "--disable-gpu",
                "--disable-dev-shm-usage",
                "--disable-setuid-sandbox",
                "--no-sandbox",
            ] });
            const page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36');
            await page.goto(url, {waitUntil: 'networkidle2'});
            let x = selector
            let textContent = await page.evaluate((x) => {
                return Promise.resolve(document.querySelector("" + x + "").innerText)
            }, x);
            await browser.close();
            return textContent
        } catch (e) {
            console.log(`${e.message}`);
            return ''
        }

    }

}


module.exports = runTasks
