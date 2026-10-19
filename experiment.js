const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

// ==========================================
// EXPERIMENT SETTINGS
// ==========================================

const WEBSITE = process.argv[2];
const CONDITION = process.argv[3];
const TRIAL = process.argv[4] || "1";

//newElla
// Set consistent waiting times for each experiment.
// Times are measured in milliseconds.
const INITIAL_WAIT_MS = 10000;
const AFTER_CONSENT_WAIT_MS = 10000;
const AFTER_BROWSING_WAIT_MS = 5000;

//newElla
// Define the allowed cookie consent conditions.
const VALID_CONDITIONS = [
    "no-choice",
    "accept",
    "reject",
    "custom"
];

if (!WEBSITE || !CONDITION) {
    console.log("\nUsage:");
    console.log("node experiment.js <website> <condition> <trial>");
    console.log("\nExample:");
    console.log("node experiment.js https://example.com accept 1\n");
    process.exit(1);
}

//newElla
// Check that the website, condition, and trial are valid.
let parsedURL;

try {
    parsedURL = new URL(WEBSITE);

    if (
        parsedURL.protocol !== "http:" &&
        parsedURL.protocol !== "https:"
    ) {
        throw new Error("Invalid website protocol");
    }
} catch (error) {
    console.log("Please enter a valid website URL.");
    process.exit(1);
}

if (!VALID_CONDITIONS.includes(CONDITION)) {
    console.log("Invalid condition.");
    console.log("Use: no-choice, accept, reject, or custom");
    process.exit(1);
}

if (!/^[a-zA-Z0-9_-]+$/.test(TRIAL)) {
    console.log("Please use a simple trial number or identifier.");
    process.exit(1);
}

// ==========================================
// CREATE RESULT DIRECTORY
// ==========================================

const hostname = parsedURL.hostname.replace(/^www\./, "");

const resultDirectory = path.join(
    "results",
    hostname,
    "chrome",
    CONDITION,
    `trial-${TRIAL}`
);

//newElla
// Prevent completed experiment results from being overwritten.
if (fs.existsSync(path.join(resultDirectory, "metadata.json"))) {
    console.log("This trial already exists.");
    console.log("Please choose a different trial number.");
    process.exit(1);
}

fs.mkdirSync(resultDirectory, { recursive: true });

console.log("\n==========================================");
console.log("COOKIE CONSENT EXPERIMENT");
console.log("==========================================");
console.log(`Website:   ${WEBSITE}`);
console.log(`Condition: ${CONDITION}`);
console.log(`Trial:     ${TRIAL}`);
console.log(`Results:   ${resultDirectory}`);
console.log("==========================================\n");

//newElla
// Create a function that waits for the user to press ENTER.
// This allows manual interaction with the website.
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

//newElla
// Identify requests going to different hostnames.
// This is an approximate third-party classification.
// It does not prove that a request is tracking.
function isThirdParty(requestURL) {

    try {
        const requestHost = new URL(requestURL).hostname;
        const siteHost = parsedURL.hostname;

        return (
            requestHost !== siteHost &&
            !requestHost.endsWith("." + siteHost) &&
            !siteHost.endsWith("." + requestHost)
        );

    } catch (error) {
        return null;
    }
}

// ==========================================
// START CHROME
// ==========================================

(async () => {

    let browser;
    let context;

    const requests = [];

    //newElla
    // Store experiment errors and measurement checkpoints.
    const errors = [];
    const checkpoints = [];

    //newElla
    // Track which part of the experiment is running.
    let stage = "initial-load";

    const startTime = new Date().toISOString();

    try {

        browser = await chromium.launch({
            channel: "chrome",
            headless: false
        });

        // A completely fresh browser context
        context = await browser.newContext();

        const page = await context.newPage();

        // ==========================================
        // RECORD NETWORK REQUESTS
        // ==========================================

        //newElla
        // Record requests from the entire browser context.
        // This includes requests from additional tabs.
        // Save the experiment stage and third-party status.
        context.on("request", request => {

            requests.push({
                timestamp: new Date().toISOString(),
                stage: stage,
                method: request.method(),
                url: request.url(),
                resourceType: request.resourceType(),
                thirdPartyByHostname: isThirdParty(request.url())
            });

        });

        //newElla
        // Create a function to save cookies, browser storage,
        // and screenshots at different experiment stages.
        async function saveSnapshot(label) {

            // Collect all cookies in the browser context.
            const cookies = await context.cookies();

            fs.writeFileSync(
                path.join(resultDirectory, `${label}-cookies.json`),
                JSON.stringify(cookies, null, 2)
            );

            //newElla
            // Collect localStorage and sessionStorage.
            // Each open tab is checked separately.
            const pages = [];

            for (const openPage of context.pages()) {

                if (openPage.isClosed()) {
                    continue;
                }

                const pageData = {
                    url: openPage.url()
                };

                try {

                    pageData.storage = await openPage.evaluate(() => {

                        return {
                            localStorage: Object.fromEntries(
                                Object.entries(localStorage)
                            ),

                            sessionStorage: Object.fromEntries(
                                Object.entries(sessionStorage)
                            )
                        };

                    });

                } catch (error) {

                    pageData.storageError = error.message;

                }

                pages.push(pageData);
            }

            fs.writeFileSync(
                path.join(resultDirectory, `${label}-storage.json`),
                JSON.stringify(pages, null, 2)
            );

            //newElla
            // Take a screenshot of the original website tab.
            // This can document the cookie notice and page state.
            try {

                if (!page.isClosed()) {

                    await page.screenshot({
                        path: path.join(
                            resultDirectory,
                            `${label}.png`
                        ),
                        fullPage: false,
                        timeout: 10000
                    });

                }

            } catch (error) {

                errors.push(
                    `${label} screenshot: ${error.message}`
                );

            }

            //newElla
            // Record the time and cookie/request counts.
            const record = {
                label: label,
                timestamp: new Date().toISOString(),
                cookieCount: cookies.length,
                requestCountSoFar: requests.length
            };

            checkpoints.push(record);

            console.log(
                `${label}: ${cookies.length} cookies, ` +
                `${requests.length} requests so far`
            );
        }

        // ==========================================
        // START EXPERIMENT
        // ==========================================

        console.log("Opening website...\n");

        try {

            await page.goto(WEBSITE, {
                waitUntil: "domcontentloaded",
                timeout: 60000
            });

        } catch (error) {

            console.log("Page load warning:");
            console.log(error.message);

            errors.push(error.message);
        }

        // ==========================================
        // BEFORE CONSENT MEASUREMENT
        // ==========================================

        //newElla
        // Wait a fixed amount of time before interacting
        // with the cookie banner.
        console.log(
            `Waiting ${INITIAL_WAIT_MS / 1000} seconds ` +
            "before the first measurement..."
        );

        await page.waitForTimeout(INITIAL_WAIT_MS);

        //newElla
        // Save cookies, storage, and screenshot before consent.
        await saveSnapshot("before-consent");

        // ==========================================
        // MANUAL COOKIE CONSENT STEP
        // ==========================================

        //newElla
        // Allow the user to manually accept, reject,
        // customize, or ignore the cookie notice.
        stage = "consent-action";

        console.log("\n==========================================");
        console.log("MANUAL COOKIE CONSENT STEP");
        console.log("==========================================");

        console.log(`Condition: ${CONDITION}`);

        console.log(`
Follow the assigned cookie consent condition.

accept:
    Accept all cookies.

reject:
    Reject optional cookies.

no-choice:
    Do not interact with the cookie notice.

custom:
    Select the predetermined custom settings.

When finished, return to VS Code.
`);

        await waitForEnter(
            "Press ENTER after the consent step: "
        );

        // ==========================================
        // AFTER CONSENT MEASUREMENT
        // ==========================================

        //newElla
        // Wait the same amount of time after each consent action.
        stage = "post-consent";

        console.log(
            `Waiting ${AFTER_CONSENT_WAIT_MS / 1000} seconds...`
        );

        await page.waitForTimeout(AFTER_CONSENT_WAIT_MS);

        //newElla
        // Save cookies, storage, and screenshot after consent.
        await saveSnapshot("after-consent");

        // ==========================================
        // MANUAL BROWSING STEP
        // ==========================================

        //newElla
        // Allow the user to browse the website manually.
        // The same pages and interactions should be used
        // for each consent condition.
        stage = "browsing";

        console.log("\n==========================================");
        console.log("MANUAL BROWSING STEP");
        console.log("==========================================");

        console.log(`
The website is still open.

Follow your group's predetermined browsing procedure.

1. Visit the same selected pages.
2. Keep the page order consistent.
3. Wait the same amount of time on each page.
4. Perform the same website interaction.

When finished, return to VS Code.

Do NOT close Chrome yourself.
`);

        await waitForEnter(
            "Press ENTER when finished browsing: "
        );

        // ==========================================
        // FINAL MEASUREMENT
        // ==========================================

        //newElla
        // Allow remaining network activity to occur
        // before taking the final measurement.
        stage = "final-observation";

        await page.waitForTimeout(AFTER_BROWSING_WAIT_MS);

        //newElla
        // Save final cookies, storage, and screenshot.
        await saveSnapshot("final");

        // ==========================================
        // SAVE REQUESTS
        // ==========================================

        fs.writeFileSync(
            path.join(resultDirectory, "requests.json"),
            JSON.stringify(requests, null, 2)
        );

        //newElla
        // Save separate request files for each experiment stage.
        const stages = [
            "initial-load",
            "consent-action",
            "post-consent",
            "browsing",
            "final-observation"
        ];

        for (const name of stages) {

            const stageRequests = requests.filter(request => {
                return request.stage === name;
            });

            fs.writeFileSync(
                path.join(
                    resultDirectory,
                    `${name}-requests.json`
                ),
                JSON.stringify(stageRequests, null, 2)
            );
        }

        // ==========================================
        // SAVE COOKIES
        // ==========================================

        const cookies = await context.cookies();

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

            trial: TRIAL,

            startTime: startTime,

            endTime: endTime,

            requestCount: requests.length,

            cookieCount: cookies.length,

            //newElla
            // Save experiment timing settings.
            waitTimesMs: {
                initial: INITIAL_WAIT_MS,
                afterConsent: AFTER_CONSENT_WAIT_MS,
                afterBrowsing: AFTER_BROWSING_WAIT_MS
            },

            //newElla
            // Save measurements from each checkpoint.
            checkpoints: checkpoints,

            //newElla
            // Count requests classified as third-party by hostname.
            thirdPartyRequestCountByHostname: requests.filter(
                request => request.thirdPartyByHostname === true
            ).length,

            //newElla
            // Record any errors encountered during the experiment.
            errors: errors
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

    } catch (error) {

        console.log("Experiment failed:");
        console.log(error.message);

        process.exitCode = 1;

    } finally {

        //newElla
        // Always close the browser when the experiment ends,
        // even if an error occurs.
        if (context) {
            await context.close().catch(() => {});
        }

        if (browser) {
            await browser.close().catch(() => {});
        }

        console.log("\nChrome closed.");
        console.log("You can now start the next trial.\n");
    }

})();