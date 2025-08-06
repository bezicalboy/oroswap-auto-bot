import * as fs from 'fs';import * as path from 'path';import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";import { GasPrice } from "@cosmjs/stargate";import { stringToPath } from "@cosmjs/crypto";

// ===================== CONFIGURATION ===================== //
const CONFIG = {
    // Network Configuration
    RPC_ENDPOINT: process.env.RPC_ENDPOINT || "wss://rpc-t.zigchain.nodestake.org",
    SEED_FILE: path.resolve(__dirname, 'seed.txt'),

    // Account Configuration
    ACCOUNT_COUNT: 6,          // Number of accounts to derive from seed
    MIN_ZIG_BALANCE: "100000", // Minimum 1 ZIG (in uzig) to activate account

    // Liquidity Provisioning Configuration (EDIT THESE)
    ASSET1_AMOUNT: "10",
    ASSET1_DENOM: "coin.zig10rfjm85jmzfhravjwpq3hcdz8ngxg7lxd0drkr.uoro",
    ASSET2_AMOUNT: "12",
    ASSET2_DENOM: "uzig",
    SLIPPAGE_TOLERANCE: "0.5",

    // Contract Addresses
    LP_CONTRACT: "zig15jqg0hmp9n06q0as7uk3x9xkwr9k3r7yh4ww2uc0hek8zlryrgmsamk4qg",

    // Gas Configuration
    GAS_PRICE: "0.025uzig"
};
// =============== END OF CONFIGURATION ================ //

// Helper Types
interface Account {
    client: SigningCosmWasmClient;
    address: string;
    balance?: string;
}

class TooManyRequestsError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TooManyRequestsError";
    }
}

async function initAccounts(): Promise<Account[]> {
    console.log(`🔥 Initializing accounts... Deriving ${CONFIG.ACCOUNT_COUNT} accounts.`);
    const seedPhrase = fs.readFileSync(CONFIG.SEED_FILE, 'utf-8').trim();
    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(seedPhrase, {
        prefix: "zig",
        hdPaths: Array.from({length: CONFIG.ACCOUNT_COUNT}, (_, i) => stringToPath(`m/44'/118'/0'/0/${i}`))
    });

    const accounts = await wallet.getAccounts();
    const clients = await Promise.all(
        accounts.map(acc =>
            SigningCosmWasmClient.connectWithSigner(
                CONFIG.RPC_ENDPOINT,
                wallet,
                { gasPrice: GasPrice.fromString(CONFIG.GAS_PRICE) }
            )
        )
    );

    // Verify balances
    const accountsWithBalance = await Promise.all(
        accounts.map(async (acc, i) => {
            const balance = await clients[i].getBalance(acc.address, "uzig");
            return {
                client: clients[i],
                address: acc.address,
                balance: balance.amount
            };
        })
    );

    const filteredAccounts = accountsWithBalance.filter(acc =>
        parseInt(acc.balance) >= parseInt(CONFIG.MIN_ZIG_BALANCE)
    );

    console.log(`✅ Found ${filteredAccounts.length} accounts with sufficient balance.`);
    return filteredAccounts;
}

async function executeAddLiquidity(account: Account): Promise<boolean> {
    const accountId = account.address.slice(-4);

    try {
        const msg = {
            provide_liquidity: {
                assets: [
                    {
                        info: { native_token: { denom: CONFIG.ASSET1_DENOM } },
                        amount: CONFIG.ASSET1_AMOUNT
                    },
                    {
                        info: { native_token: { denom: CONFIG.ASSET2_DENOM } },
                        amount: CONFIG.ASSET2_AMOUNT
                    }
                ],
                slippage_tolerance: CONFIG.SLIPPAGE_TOLERANCE,
                auto_stake: true
            }
        };

        const funds = [
            { denom: CONFIG.ASSET1_DENOM, amount: CONFIG.ASSET1_AMOUNT },
            { denom: CONFIG.ASSET2_DENOM, amount: CONFIG.ASSET2_AMOUNT }
        ];

        const result = await account.client.execute(
            account.address,
            CONFIG.LP_CONTRACT,
            msg,
            "auto",
            "Add LP",
            funds
        );

        console.log(`✅ [${accountId}] Add LP | ${CONFIG.ASSET1_AMOUNT}${CONFIG.ASSET1_DENOM} + ${CONFIG.ASSET2_AMOUNT}${CONFIG.ASSET2_DENOM} | Tx: ${result.transactionHash.slice(0, 8)}`);
        return true;
    } catch (error) {
        if (error instanceof TooManyRequestsError) throw error;
        console.log(`❌ [${accountId}] Add LP | Failed: ${error.message.split('\n')[0]}`);
        return false;
    }
}


async function initializeWalletAndClient(mnemonic: string) {
  const accounts = await initAccounts();
  if (accounts.length === 0) {
    throw new Error("No accounts found with sufficient balance.");
  }
  return { client: accounts[0].client, accounts: accounts };
}

async function main() {
  const mnemonic = fs.readFileSync("./seed.txt", "utf8").trim();
  let accounts: Account[] = [];

  while (true) {
    try {
      if (accounts.length === 0) {
        const { accounts: initializedAccounts } = await initializeWalletAndClient(mnemonic);
        accounts = initializedAccounts;
        console.log("Wallet and clients initialized for all accounts.");
      }

      let cycle = 0;
      while (true) {
        cycle++;
        console.log(`CYCLE ${cycle}`);
        const lpPromises = accounts.map(account => executeAddLiquidity(account));
        await Promise.all(lpPromises);

        await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second delay
      }
    } catch (error) {
      console.error(`An error occurred: ${error.message}.`);
      if (error.message.includes("Connection attempt timed out")) {
        console.log("Connection timed out. Re-initializing connections...");
      } else {
        console.log("An unexpected error occurred. Restarting the process in 10 seconds...");
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
      accounts = []; // Reset accounts to trigger re-initialization
    }
  }
}

main().catch(console.error);
