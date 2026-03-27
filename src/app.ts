import './loadEnv.js';
import './patches.js';
import Utility from "./Utility.js";
import os from 'os';
import axios from 'axios';
import puppeteer, { Browser, Page } from 'puppeteer';
import logger from './logger.js';
import { authenticator } from 'otplib';
import githubAnnotation from './annotations.js';

const MAX_TIMEOUT = Math.pow(2, 31) - 1;

async function getLatestEmail(name: string, pwd: string, sender?: string, subject?: string) {
    const apiUrl = 'https://api.bujidian.com/getMailInfo';

    const { data } = await axios.post(apiUrl, { name, pwd, sender, subject });

    if (data.status == 1) {
        console.log('✅ 邮件获取成功！\n', data.message);
        return data.message;
    } else {
        console.error('❌ 邮件获取失败:', data.message);
        return {};
    }
}

(async () => {
    const headless = os.platform() == 'linux';

    const chrome = await puppeteer.launch({
        headless,
        defaultViewport: null,
        protocolTimeout: MAX_TIMEOUT,
        slowMo: 20,
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false,
        // devtools: true,
        args: [
            '--lang=en-US',
            '--window-size=1920,1080',
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-zygote',
            '--disable-gpu',
            '--disable-extensions-file-access-check',
            '--disable-extensions-http-throttling'
        ]
    });

    logger.info(chrome.process().spawnfile, await chrome.version(), chrome.wsEndpoint());

    async function screenshotAllPages() {
        const timestamp = new Date().toString().replace(/[:.]/g, '-');

        const pages = await chrome.pages();
        logger.info("screenshotAllPages", pages.length);
        for (let i = 0; i < pages.length; i++) {
            await pages[i].screenshot({ path: `./images/chrome-${timestamp}-${i + 1}.png` }).catch(logger.error);
        }
    }

    process.on('exit', (code) => {
        // 不能执行异步代码
        logger.info(`进程退出，代码: ${code}，耗时：${Math.round(process.uptime())}秒`);
    });

    process.on('SIGTERM', async () => {
        // timeout docker-compose down/stop 会触发 SIGTERM 信号
        githubAnnotation('error', 'SIGTERM: 终止请求');
        await screenshotAllPages();
        process.exit(1);
    });

    process.on("unhandledRejection", async (e: Error) => {
        githubAnnotation('error', "未处理的拒绝: " + (e.stack || e));
        await screenshotAllPages();
        process.exit(1);
    });

    const userMail = process.env.EMAIL;
    const password = process.env.PASSWORD;

    const page = await chrome.newPage();
    await page.goto("https://chatgpt.com/");
    await page.click("//button[contains(., 'Sign up for free')]");

    await page.type("//input[@name='email']", userMail);
    await page.click("//button[contains(@class, 'btn-primary') and .//text()='Continue']");
    await page.waitForNavigation();
    await page.type("//input[@name='new-password']", process.env.CLIENT_ID);
    await page.click("//button[contains(., 'Continue')]");
    // await page.waitForNavigation();

    const { subject } = await getLatestEmail(userMail, password);

    const [code] = subject.match(/\d{6}/);

    console.log("提取到的验证码是:", code);

    await page.type("//input[@name='code']", code);
    await page.click("//button[contains(., 'Continue')]");

    await page.type("//input[@placeholder='Full name']", userMail.split('@')[0].replace(/[^a-zA-Z]/g, ''));
    await page.type('//div[contains(@id,"-birthday")]//div[@contenteditable="true" and @data-type="month"]', String(Math.floor(Math.random() * 12) + 1));
    await page.type('//div[contains(@id,"-birthday")]//div[@contenteditable="true" and @data-type="day"]', String(Math.floor(Math.random() * 28) + 1));
    await page.type('//div[contains(@id,"-birthday")]//div[@contenteditable="true" and @data-type="year"]', String(1980 + Math.floor(Math.random() * 30)));
    await page.click("//button[contains(., 'Continue')]");
    await page.waitForNavigation();

    await page.goto("https://chatgpt.com/#settings/Security");
    await page.click("//button[@aria-label='Multi-factor authentication']");
    await page.click("//span[contains(., 'Trouble scanning?')]");
    const otpSecret = await page.textContent("//button[text()='Copy code']/preceding-sibling::div");
    await page.type("//input[@name='code']", authenticator.generate(otpSecret));
    await page.click("//button[contains(., 'Continue')]");
    await page.click("//input[@id='safelyRecorded']");
    await page.click("//button[contains(., 'Continue') and not(@disabled)]");

    const data = JSON.stringify([userMail, password, otpSecret, new Date().toString()]);
    Utility.appendStepSummary(data);
    headless && process.exit();
})();