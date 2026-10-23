
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const WEBSITE = process.argv[2];
const CONDITION = process.argv[3];
const TRIAL = process.argv[4] || "1";

const WAIT_MS = 10000;


const VALID_CONDITIONS = ["accept", "reject"];

if (!WEBSITE || !CONDITION) {
    console.log("Usage: node experiment.js <website> <condition> <trial>");
    process.exit(1);
}

let parsedURL;

try {
    parsedURL = new URL(WEBSITE);

    if (!["http:", "https:"].includes(parsedURL.protocol)) {
        throw new Error("Invalid protocol");
    }
} catch {
    console.log("Please enter a valid website URL.");
    process.exit(1);
}

if (!VALID_CONDITIONS.includes(CONDITION)) {
    console.log("Condition must be: accept or reject");
    process.exit(1);
}

if (!/^[a-zA-Z0-9_-]+$/.test(TRIAL)) {
    console.log("Please use a simple trial number or identifier.");
    process.exit(1);
}

const resultDirectory = path.join(
    __dirname,
    "results",
    parsedURL.hostname.replace(/^www\./, ""),
    "chrome",
    CONDITION,
    `trial-${TRIAL}`
);

if (fs.existsSync(path.join(resultDirectory, "metadata.json"))) {
    console.log("This trial already exists. Choose a different trial number.");
    process.exit(1);
}

fs.mkdirSync(resultDirectory, { recursive: true });

function waitForEnter(message) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(resolve => {
        rl.question(message, () => {
            rl.close();
            resolve();
        });
    });
}

(async () => {
    let browser;
    let context;

    const startTime = new Date().toISOString();
    const measurements = {};

    try {
        browser = await chromium.launch({
            channel: "chrome",
            headless: false
        });

        context = await browser.newContext();
        const page = await context.newPage();

        console.log(`Opening ${WEBSITE}`);

        try {
            await page.goto(WEBSITE, {
                waitUntil: "domcontentloaded",
                timeout: 60000
            });
        } catch (error) {
            console.log(`Page load warning: ${error.message}`);
        }

        // Measure cookies before consent
        console.log("Waiting 10 seconds before measuring cookies...");
        await page.waitForTimeout(WAIT_MS);

        const beforeCookies = await context.cookies();

        measurements.beforeConsent = {
            timestamp: new Date().toISOString(),
            cookieCount: beforeCookies.length
        };

        fs.writeFileSync(
            path.join(resultDirectory, "before-consent-cookies.json"),
            JSON.stringify(beforeCookies, null, 2)
        );

        await page.screenshot({
            path: path.join(resultDirectory, "before-consent.png"),
            timeout: 10000
        });

        console.log(`Before consent: ${beforeCookies.length} cookies`);

        // Manual consent choice
        console.log(`\nConsent condition: ${CONDITION}`);
        console.log("Perform your assigned consent action in Chrome.");
        console.log("When finished, press ENTER in this terminal.");

        await waitForEnter("Consent action complete? Press ENTER: ");

        // Measure cookies after consent
        console.log("Waiting 10 seconds after consent...");
        await page.waitForTimeout(WAIT_MS);

        const afterCookies = await context.cookies();

        measurements.afterConsent = {
            timestamp: new Date().toISOString(),
            cookieCount: afterCookies.length
        };

        fs.writeFileSync(
            path.join(resultDirectory, "after-consent-cookies.json"),
            JSON.stringify(afterCookies, null, 2)
        );

        await page.screenshot({
            path: path.join(resultDirectory, "after-consent.png"),
            timeout: 10000
        });

        console.log(`After consent: ${afterCookies.length} cookies`);

        // Manual browsing and final cookie count measurement
        console.log("Press ENTER here when you have finished browsing.");

        await waitForEnter("Browsing complete? Press ENTER: ");

        const finalCookies = await context.cookies();

        measurements.final = {
            timestamp: new Date().toISOString(),
            cookieCount: finalCookies.length
        };

        console.log(`Final cookie count: ${finalCookies.length}`);

        // Save metadata
        const metadata = {
            website: WEBSITE,
            browser: "Chrome",
            condition: CONDITION,
            trial: TRIAL,
            startTime,
            endTime: new Date().toISOString(),
            waitTimesMs: {
                beforeConsent: WAIT_MS,
                afterConsent: WAIT_MS
            },
            measurements
        };

        fs.writeFileSync(
            path.join(resultDirectory, "metadata.json"),
            JSON.stringify(metadata, null, 2)
        );

        console.log("\nExperiment complete.");
        console.log(`Results saved to: ${resultDirectory}`);

    } catch (error) {
        console.error("Experiment failed:", error.message);
        process.exitCode = 1;

    } finally {
        if (context) await context.close().catch(() => {});
        if (browser) await browser.close().catch(() => {});

        console.log("Chrome closed.");
    }
})();
