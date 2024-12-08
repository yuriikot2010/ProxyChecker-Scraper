const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const readline = require('readline-sync');
const pLimit = require('p-limit');
const socks = require('socks-proxy-agent'); // Required for SOCKS proxies

const linksFilePath = path.join(__dirname, 'storage/proxyscrapelinks.txt');
const proxiesFilePath = path.join(__dirname, 'proxy.txt');
const validProxiesFilePath = path.join(__dirname, 'valid_proxy.txt');

const MAX_CONCURRENCY = 5000; // Maximum concurrent threads
const TIMEOUT = 5000; // Timeout for each proxy check
const BATCH_SIZE = 10000; // Number of proxies per batch

// Helper function to make requests with timeout
async function fetchWithTimeout(url, timeout, agent) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, { signal: controller.signal, agent: agent });
        return response.ok;
    } catch {
        return false;
    } finally {
        clearTimeout(timeoutId);
    }
}

// Function to read proxies from the file
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

// Delete a file if it exists
function deleteFile(filePath) {
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
}

// Function to validate the proxy format (IP:PORT)
function isValidProxyFormat(proxy) {
    return /^(\d{1,3}\.){3}\d{1,3}:\d+$/.test(proxy);
}

// Function to check the protocol for each proxy
async function checkProtocol(proxy) {
    const [ip, port] = proxy.split(':');
    const httpUrl = `http://${ip}:${port}`;
    const httpsUrl = `https://${ip}:${port}`;
    const timeoutUrl = `http://${ip}:${port}`; // Used for SOCKS proxy validation

    // Check HTTP
    try {
        const isHttpValid = await fetchWithTimeout(httpUrl, TIMEOUT);
        if (isHttpValid) return 'http';
    } catch {}

    // Check HTTPS
    try {
        const isHttpsValid = await fetchWithTimeout(httpsUrl, TIMEOUT);
        if (isHttpsValid) return 'https';
    } catch {}

    // Check SOCKS4
    try {
        const socks4Url = `socks4://${ip}:${port}`;
        const socks4Agent = new socks.SocksProxyAgent(socks4Url);
        const isSocks4Valid = await fetchWithTimeout(timeoutUrl, TIMEOUT, socks4Agent);
        if (isSocks4Valid) return 'socks4';
    } catch {}

    // Check SOCKS5
    try {
        const socks5Url = `socks5://${ip}:${port}`;
        const socks5Agent = new socks.SocksProxyAgent(socks5Url);
        const isSocks5Valid = await fetchWithTimeout(timeoutUrl, TIMEOUT, socks5Agent);
        if (isSocks5Valid) return 'socks5';
    } catch {}

    return 'unknown';
}

// Function to check proxies
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

            const protocol = await checkProtocol(proxy); // Check the protocol
            if (protocol === 'unknown') {
                invalidCount++;
                return;
            }

            validCount++;
            validProxyStream.write(`${protocol}://${proxy}\n`);  // Save proxy with its detected protocol
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

// Function to scrape proxies
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

// Function to display the menu
function displayMenu() {
    console.clear();
    console.log("=== Proxy Scraper Menu ===");
    console.log("1. Scrape proxies");
    console.log("2. Check proxies");
    console.log("3. Exit");
    console.log("==========================");
}

// Main function to control the flow
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
