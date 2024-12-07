const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const readline = require('readline-sync');
const pLimit = require('p-limit');

const linksFilePath = path.join(__dirname, 'storage/proxyscrapelinks.txt');
const proxiesFilePath = path.join(__dirname, 'proxy.txt');
const validProxiesFilePath = path.join(__dirname, 'valid_proxy.txt');

const MAX_CONCURRENCY = 5000; // Maximum concurrent threads
const TIMEOUT = 5000; // Timeout for each proxy check
const BATCH_SIZE = 10000; // Number of proxies per batch

async function fetchWithTimeout(url, timeout) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, { signal: controller.signal });
        return response.ok;
    } catch {
        return false;
    } finally {
        clearTimeout(timeoutId);
    }
}

function readProxiesFromFile() {
    try {
        if (fs.existsSync(proxiesFilePath)) {
            return fs.readFileSync(proxiesFilePath, 'utf-8').trim().split('\n').filter(Boolean);
        }
        return [];
    } catch (error) {
        console.error("Error reading proxies file:", error.message);
        return [];
    }
}

function deleteFile(filePath) {
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
}

function isValidProxyFormat(proxy) {
    return /^(\d{1,3}\.){3}\d{1,3}:\d+$/.test(proxy);
}

async function checkProxies() {
    const proxies = readProxiesFromFile();
    if (proxies.length === 0) {
        console.log("No proxies to check!");
        return;
    }

    console.log(`Checking ${proxies.length} proxies with up to ${MAX_CONCURRENCY} threads...`);
    deleteFile(validProxiesFilePath);

    const checkedProxies = new Set();
    const validProxyStream = fs.createWriteStream(validProxiesFilePath, { flags: 'a' });

    let validCount = 0;
    let invalidCount = 0;

    const limit = pLimit(MAX_CONCURRENCY);
    const tasks = proxies.map((proxy) =>
        limit(async () => {
            if (checkedProxies.has(proxy) || !isValidProxyFormat(proxy)) {
                return;
            }
            checkedProxies.add(proxy);

            const [ip, port] = proxy.split(':');
            const isValid = await fetchWithTimeout(`http://${ip}:${port}`, TIMEOUT);

            if (isValid) {
                validCount++;
                validProxyStream.write(proxy + '\n');
            } else {
                invalidCount++;
            }
        })
    );

    // Track progress
    let processed = 0;
    const interval = setInterval(() => {
        console.clear();
        console.log(`Progress: ${processed}/${proxies.length} proxies processed.`);
        console.log(`Valid: ${validCount}, Invalid: ${invalidCount}`);
    }, 500);

    // Wait for all tasks to complete
    await Promise.all(
        tasks.map((task) =>
            task.finally(() => {
                processed++;
            })
        )
    );

    clearInterval(interval);
    validProxyStream.end();

    console.clear();
    console.log(`Proxy check completed.`);
    console.log(`Total proxies checked: ${proxies.length}`);
    console.log(`Valid proxies: ${validCount}`);
    console.log(`Invalid proxies: ${invalidCount}`);
}

async function scrapeProxies() {
    deleteFile(proxiesFilePath); // Delete previous proxies
    const links = fs.existsSync(linksFilePath)
        ? fs.readFileSync(linksFilePath, 'utf-8').trim().split('\n').filter(Boolean)
        : [];

    if (links.length === 0) {
        console.log("No links found to scrape.");
        return;
    }

    const allProxies = new Set();
    for (let i = 0; i < links.length; i++) {
        try {
            console.log(`Scraping proxies from: ${links[i]}`);
            const response = await fetch(links[i]);
            const text = await response.text();
            const proxies = text.trim().split('\n').filter(isValidProxyFormat);
            proxies.forEach((proxy) => allProxies.add(proxy));
        } catch (error) {
            console.error(`Failed to scrape from: ${links[i]} - ${error.message}`);
        }
        console.log(`Progress: ${i + 1}/${links.length} links processed.`);
    }

    fs.writeFileSync(proxiesFilePath, Array.from(allProxies).join('\n'), 'utf-8');
    console.log(`Saved ${allProxies.size} unique proxies to proxy.txt.`);
}

function displayMenu() {
    console.clear();
    console.log("=== Proxy Scraper Menu ===");
    console.log("1. Scrape proxies");
    console.log("2. Check proxies");
    console.log("3. Exit");
    console.log("==========================");
}

async function main() {
    while (true) {
        displayMenu();
        const choice = readline.question("Choose an option: ");

        if (choice === "1") {
            console.log("\nStarting proxy scraping... The menu will reopen when done.");
            await scrapeProxies();
        } else if (choice === "2") {
            console.log("\nStarting proxy check... The menu will reopen when done.");
            await checkProxies();
        } else if (choice === "3") {
            break;
        } else {
            console.log("Invalid choice, try again.");
        }
    }
}

main();
