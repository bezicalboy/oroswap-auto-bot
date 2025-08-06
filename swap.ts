import * as fs from 'fs';
import * as path from 'path';
import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { GasPrice } from "@cosmjs/stargate";
import { stringToPath } from "@cosmjs/crypto";
import { AccountData } from "@cosmjs/proto-signing";
import { Coin as StargateCoin } from "@cosmjs/stargate";

// Utility function for delays
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

interface EnvConfig {
    RPC_ENDPOINT: string;
    [key: string]: string;
}

// Function to parse .env file
function parseEnvFile(filePath: string): EnvConfig {
    const env: EnvConfig = { RPC_ENDPOINT: '' }; // Initialize with known keys
    const content = fs.readFileSync(filePath, 'utf-8');
    content.split('\n').forEach(line => {
        const trimmedLine = line.trim();
        if (trimmedLine && !trimmedLine.startsWith('#')) {
            const [key, value] = trimmedLine.split('=');
            if (key && value) {
                env[key.trim()] = value.trim().replace(/^"|"$/g, ''); // Remove quotes
            }
        }
    });
    return env;
}

// Load environment variables manually
const envPath = path.resolve(__dirname, '.env');
const envConfig = parseEnvFile(envPath);

// Function to read seed phrases from seed.txt
function readSeedPhrases(filePath: string): string[] {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        return content.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    } catch (error: any) {
        console.error(`[INIT] Error reading seed.txt: ${error.message}`);
        return [];
    }
}

// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
// 👇👇👇 BOT CONFIGURATION - EDIT THESE VALUES 👇👇👇
// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

// --- Wallet & Chain Config ---
const RPC_ENDPOINT: string = envConfig.RPC_ENDPOINT;
const SEED_PHRASES: string[] = readSeedPhrases(path.resolve(__dirname, 'seed.txt'));

// --- General Bot Config ---
const ADDRESS_PREFIX: string = "zig";
const GAS_DENOM: string = "uzig";

// --- Token Denominations ---
const ZIG_DENOM: string = "uzig";
const ORO_DENOM: string = "coin.zig10rfjm85jmzfhravjwpq3hcdz8ngxg7lxd0drkr.uoro";

// --- Contract Addresses ---
const SWAP_CONTRACT_ADDRESS: string = "zig1vhr7hx0yeww0uwe2zlp6mst5g6aup85engzntlyv52rkmxsykvdskfv0tu";
const LIQUIDITY_CONTRACT_ADDRESS: string = "zig15jqg0hmp9n06q0as7uk3x9xkwr9k3r7yh4ww2uc0hek8zlryrgmsamk4qg";

// --- Hardcoded Swap Values ---
const ZIG_TO_ORO_AMOUNT: string = "2000"; // 0.002 ZIG
const ZIG_TO_ORO_BELIEF_PRICE: string = "1.255492780916509732";
const ORO_TO_ZIG_AMOUNT: string = "1500"; // 0.0015 ORO
const ORO_TO_ZIG_BELIEF_PRICE: string = "0.797448165869218517";
const MAX_SPREAD: string = "0.005"; // 0.5%

// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
// 👆👆👆 END OF CONFIGURATION 👆👆👆
// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

// Colors for console output
const colors = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    dim: "\x1b[2m",
    underscore: "\x1b[4m",
    blink: "\x1b[5m",
    reverse: "\x1b[7m",
    hidden: "\x1b[8m",
    
    // Foreground colors
    fg: {
        black: "\x1b[30m",
        red: "\x1b[31m",
        green: "\x1b[32m",
        yellow: "\x1b[33m",
        blue: "\x1b[34m",
        magenta: "\x1b[35m",
        cyan: "\x1b[36m",
        white: "\x1b[37m",
        crimson: "\x1b[38m"
    },
    
    // Background colors
    bg: {
        black: "\x1b[40m",
        red: "\x1b[41m",
        green: "\x1b[42m",
        yellow: "\x1b[43m",
        blue: "\x1b[44m",
        magenta: "\x1b[45m",
        cyan: "\x1b[46m",
        white: "\x1b[47m",
        crimson: "\x1b[48m"
    }
};

interface TxConfig {
    contractAddress: string;
    msg: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    funds: StargateCoin[];
    memo: string;
}

interface AccountInfo {
    client: SigningCosmWasmClient;
    account: AccountData;
    address: string;
}

let accountsInfo: AccountInfo[] = [];

function formatAccount(accountIndex: number, address: string): string {
    return `${colors.fg.cyan}Acc ${accountIndex}${colors.reset} | ${address.substring(0, 4)}...${address.substring(address.length - 4)}`;
}

function logHeader(message: string): void {
    console.log(`\n${colors.fg.magenta}${'='.repeat(50)}`);
    console.log(`${colors.bright}${message}${colors.reset}`);
    console.log(`${colors.fg.magenta}${'='.repeat(50)}${colors.reset}\n`);
}

function logCycleHeader(cycleCount: number): void {
    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    logHeader(`🚀 Cycle #${cycleCount} | ${timeString}`);
}

async function executeContract(client: SigningCosmWasmClient, senderAddress: string, txConfig: TxConfig, accountIdentifier: string): Promise<any> {
    const action = txConfig.memo;
    process.stdout.write(`${accountIdentifier} ${colors.dim}›${colors.reset} ${action}... `);

    if (!txConfig.contractAddress || !txConfig.msg || !txConfig.funds) {
        throw new Error("Invalid transaction configuration.");
    }

    return client.execute(
        senderAddress,
        txConfig.contractAddress,
        txConfig.msg,
        "auto",
        txConfig.memo,
        txConfig.funds
    );
}

async function performSwapCycleForAccount(accountInfo: AccountInfo, cycleCount: number): Promise<void> {
    const { client, address } = accountInfo;
    const accountIndex = accountsInfo.findIndex(a => a.address === address) + 1;
    const accountIdentifier = formatAccount(accountIndex, address);

    const transactions: { promise: Promise<any>; memo: string }[] = [];

    // SWAP ZIG -> ORO
    const swapZigToOroTx: TxConfig = {
        contractAddress: LIQUIDITY_CONTRACT_ADDRESS,
        msg: { 
            swap: { 
                offer_asset: { 
                    info: { native_token: { denom: ZIG_DENOM } }, 
                    amount: ZIG_TO_ORO_AMOUNT 
                }, 
                belief_price: ZIG_TO_ORO_BELIEF_PRICE, 
                max_spread: MAX_SPREAD 
            } 
        },
        funds: [{ denom: ZIG_DENOM, amount: ZIG_TO_ORO_AMOUNT }],
        memo: `Swap ZIG → ORO`
    };
    transactions.push({ promise: executeContract(client, address, swapZigToOroTx, accountIdentifier), memo: swapZigToOroTx.memo });

    // SWAP ORO -> ZIG
    const swapOroToZigTx: TxConfig = {
        contractAddress: LIQUIDITY_CONTRACT_ADDRESS,
        msg: { 
            swap: { 
                offer_asset: { 
                    info: { native_token: { denom: ORO_DENOM } }, 
                    amount: ORO_TO_ZIG_AMOUNT 
                }, 
                belief_price: ORO_TO_ZIG_BELIEF_PRICE, 
                max_spread: MAX_SPREAD 
            } 
        },
        funds: [{ denom: ORO_DENOM, amount: ORO_TO_ZIG_AMOUNT }],
        memo: `Swap ORO → ZIG`
    };
    transactions.push({ promise: executeContract(client, address, swapOroToZigTx, accountIdentifier), memo: swapOroToZigTx.memo });

    const results = await Promise.allSettled(transactions.map(tx => tx.promise));

    results.forEach((result, index) => {
        const memo = transactions[index].memo;
        if (result.status === 'fulfilled') {
            console.log(`${accountIdentifier} ${colors.dim}›${colors.reset} ${memo}... ${colors.fg.green}✓ Success${colors.reset} | TxHash: ${colors.fg.cyan}${result.value.transactionHash.substring(0, 10)}...${colors.reset}`);
        } else {
            console.log(`${accountIdentifier} ${colors.dim}›${colors.reset} ${memo}... ${colors.fg.red}✗ Failed${colors.reset} | Error: ${colors.fg.red}${result.reason.message.split('\n')[0]}${colors.reset}`);
        }
    });
}

async function fastSwapCycle(): Promise<void> {
    logHeader("🚀 Starting ZIG/ORO Swap Bot");

    if (SEED_PHRASES.length === 0) {
        console.error(`${colors.fg.red}[FATAL] No seed phrases found in seed.txt. Exiting.${colors.reset}`);
        return;
    }
    if (!RPC_ENDPOINT) {
        console.error(`${colors.fg.red}[FATAL] RPC_ENDPOINT is not set in the .env file. Exiting.${colors.reset}`);
        return;
    }

    const NUM_ACCOUNTS_TO_CHECK_PER_SEED: number = 7;

    console.log(`${colors.fg.blue}⏳ Initializing accounts...${colors.reset}`);
    
    for (const mnemonic of SEED_PHRASES) {
        for (let i = 0; i < NUM_ACCOUNTS_TO_CHECK_PER_SEED; i++) {
            try {
                const hdPath = stringToPath(`m/44'/118'/0'/0/${i}`);
                const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, { prefix: ADDRESS_PREFIX, hdPaths: [hdPath] });
                const [account] = await wallet.getAccounts();

                const client = await SigningCosmWasmClient.connectWithSigner(
                    RPC_ENDPOINT,
                    wallet,
                    { gasPrice: GasPrice.fromString(`0.025${GAS_DENOM}`) }
                );

                const balance = await client.getBalance(account.address, ZIG_DENOM);
                if (parseInt(balance.amount) > 2000000) {
                    accountsInfo.push({ client, account, address: account.address });
                    const balanceInZig = (parseInt(balance.amount) / 1000000).toFixed(2);
                    console.log(`${colors.fg.green}✓${colors.reset} ${formatAccount(accountsInfo.length, account.address)} | Balance: ${colors.fg.yellow}${balanceInZig} ZIG${colors.reset}`);
                }
            } catch (error: any) {
                console.error(`${colors.fg.red}✗${colors.reset} Failed to initialize wallet for account index ${i}: ${error.message}`);
            }
            await sleep(250);
        }
    }

    if (accountsInfo.length === 0) {
        console.error(`${colors.fg.red}[FATAL] No accounts with sufficient balance could be initialized. Exiting.${colors.reset}`);
        return;
    }

    console.log(`\n${colors.fg.green}✅ Initialization complete${colors.reset}`);
    console.log(`${colors.fg.blue}• RPC:${colors.reset} ${RPC_ENDPOINT}`);
    console.log(`${colors.fg.blue}• Active accounts:${colors.reset} ${accountsInfo.length}`);
    console.log(`${colors.fg.blue}• Swap amount:${colors.reset} ${parseFloat(ZIG_TO_ORO_AMOUNT)/1000} ZIG → ${parseFloat(ORO_TO_ZIG_AMOUNT)/1000} ORO\n`);

    // Execute swap loop
    let cycleCount = 0;
    while (true) {
        cycleCount++;
        logCycleHeader(cycleCount);

        const swapPromises = accountsInfo.map(accountInfo => performSwapCycleForAccount(accountInfo, cycleCount));
        await Promise.allSettled(swapPromises);
    }
}

// --- BOT EXECUTION ---
fastSwapCycle();