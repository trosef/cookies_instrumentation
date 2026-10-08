const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

// ==========================================
// EXPERIMENT SETTINGS
// ==========================================

// Change these for each experiment
const WEBSITE = process.argv[2];
const CONDITION = process.argv[3];
const TRIAL = process.argv[4] || "1";

// Conditions:
// no-choice
// accept
// reject
// custom

if (!WEBSITE || !CONDITION) {
    console.log("\nUsage:");
    console.log("node experiment.js <website> <condition> <trial>");
    console.log("\nExample:");
    console.log("node experiment.js https://example.com accept 1\n");
    process.exit(1);
}

// ==========================================
// CREATE RESULT DIRECTORY
// ==========================================

const hostname = new URL(WEBSITE).hostname.replace(/^www\./, "");

const resultDirectory = path.join(
    "results",
    hostname,
    "chrome",
    CONDITION,
    `trial-${TRIAL}`
);

fs.mkdirSync(resultDirectory, { recursive: true });

console.log("\n==========================================");
console.log("COOKIE CONSENT EXPERIMENT");
console.log("==========================================");
console.log(`Website:   ${WEBSITE}`);
console.log(`Condition: ${CONDITION}`);
console.log(`Trial:     ${TRIAL}`);
console.log(`Results:   ${resultDirectory}`);
console.log("==========================================\n");

// ==========================================
// START CHROME
// ==========================================

(async () => {

    const browser = await chromium.launch({
        channel: "chrome",
        headless: false
    });

    // A completely fresh browser context
    const context = await browser.newContext();

    const page = await context.newPage();

    // ==========================================
    // RECORD NETWORK REQUESTS
    // ==========================================

    const requests = [];

    page.on("request", request => {

        requests.push({
            timestamp: new Date().toISOString(),
            method: request.method(),
            url: request.url(),
            resourceType: request.resourceType()
        });

    });

    // ==========================================
    // START EXPERIMENT
    // ==========================================

    const startTime = new Date().toISOString();

    console.log("Opening website...\n");

    try {

        await page.goto(WEBSITE, {
            waitUntil: "domcontentloaded",
            timeout: 60000
        });

    } catch (error) {

        console.log("Page load warning:");
        console.log(error.message);

    }

    console.log("\n==========================================");
    console.log("MANUAL STEP");
    console.log("==========================================");

    console.log(`
The Chrome window is now open.

Condition: ${CONDITION}

Follow your experimental procedure manually.

When you have finished browsing the website,
return to this terminal and press ENTER.

Do NOT close the Chrome window yourself.
`);

    // ==========================================
    // WAIT FOR USER
    // ==========================================

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    await new Promise(resolve => {

        rl.question("Press ENTER when finished: ", () => {
            rl.close();
            resolve();
        });

    });

    // ==========================================
    // COLLECT COOKIES
    // ==========================================

    const cookies = await context.cookies();

    // ==========================================
    // SAVE REQUESTS
    // ==========================================

    fs.writeFileSync(
        path.join(resultDirectory, "requests.json"),
        JSON.stringify(requests, null, 2)
    );

    // ==========================================
    // SAVE COOKIES
    // ==========================================

    fs.writeFileSync(
        path.join(resultDirectory, "cookies.json"),
        JSON.stringify(cookies, null, 2)
    );

    // ==========================================
    // SAVE METADATA
    // ==========================================

    const endTime = new Date().toISOString();

    const metadata = {

        website: WEBSITE,

        browser: "Chrome",

        condition: CONDITION,

        trial: Number(TRIAL),

        startTime: startTime,

        endTime: endTime,

        requestCount: requests.length,

        cookieCount: cookies.length

    };

    fs.writeFileSync(
        path.join(resultDirectory, "metadata.json"),
        JSON.stringify(metadata, null, 2)
    );

    // ==========================================
    // FINISH
    // ==========================================

    console.log("\n==========================================");
    console.log("EXPERIMENT COMPLETE");
    console.log("==========================================");

    console.log(`Requests recorded: ${requests.length}`);
    console.log(`Cookies recorded:  ${cookies.length}`);
    console.log(`Results saved to:  ${resultDirectory}`);

    await context.close();
    await browser.close();

    console.log("\nChrome closed.");
    console.log("You can now start the next trial.\n");

})();