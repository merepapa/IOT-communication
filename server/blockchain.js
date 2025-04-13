const { Web3 } = require('web3');
const fs = require('fs').promises;
const fsSync = require('fs');  // Add synchronous fs for file existence check
const path = require('path');
const solc = require('solc');

class BlockchainManager {
    constructor() {
        this.web3 = null;
        this.contract = null;
        this.contractAddress = null;
        this.defaultAccount = null;
        this.initialized = false;
    }

    async connectToGanache(retries = 3, delay = 2000) {
        for (let i = 0; i < retries; i++) {
            try {
                this.web3 = new Web3(new Web3.providers.HttpProvider('http://127.0.0.1:7545'));
                await this.web3.eth.net.getId(); // Test connection
                console.log('Successfully connected to Ganache');
                return true;
            } catch (error) {
                console.error(`Failed to connect to Ganache (attempt ${i + 1}/${retries}):`, error.message);
                if (i < retries - 1) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        throw new Error('Failed to connect to Ganache after multiple attempts');
    }

    async initialize() {
        // Prevent multiple initializations
        if (this.initialized) {
            console.log('Blockchain manager already initialized');
            return true;
        }

        try {
            // Connect to Ganache
            await this.connectToGanache();

            // Get accounts
            const accounts = await this.web3.eth.getAccounts();
            if (!accounts || accounts.length === 0) {
                throw new Error('No accounts found in Ganache');
            }
            this.defaultAccount = accounts[0];
            
            // Compile and deploy contract
            await this.compileAndDeploy();
            
            console.log('Blockchain manager initialized successfully');
            this.initialized = true;
            return true;
        } catch (error) {
            console.error('Failed to initialize blockchain manager:', error);
            return false;
        }
    }

    async compileAndDeploy() {
        try {
            // Check if contract is already deployed - use synchronous fs for this check
            const addressFile = path.join(__dirname, 'contract-address.json');
            console.log(`Looking for contract address at: ${addressFile}`);
            
            if (fsSync.existsSync(addressFile)) {
                try {
                    console.log('Found existing contract address file');
                    const addressData = JSON.parse(await fs.readFile(addressFile, 'utf8'));
                    
                    if (!addressData.address || !addressData.abi) {
                        console.error('Invalid contract address data:', addressData);
                        throw new Error('Invalid contract address data in file');
                    }
                    
                    console.log(`Loading contract from address: ${addressData.address}`);
                    
                    // Create contract instance from existing address
                    this.contract = new this.web3.eth.Contract(
                        addressData.abi,
                        addressData.address
                    );
                    this.contractAddress = addressData.address;
                    
                    // Verify the contract is working by calling a read-only method
                    try {
                        // Just test if we can call a contract method to verify connection
                        await this.contract.methods.getDataCount('test').call();
                        console.log('✅ Successfully connected to existing contract at:', addressData.address);
                        return true;
                    } catch (verifyError) {
                        console.error('❌ Failed to verify contract connection:', verifyError.message);
                        console.log('Will deploy a new contract instead');
                    }
                } catch (loadError) {
                    console.error('❌ Error loading saved contract:', loadError.message);
                    console.log('Will deploy a new contract instead');
                }
            } else {
                console.log('No saved contract found, deploying new one');
            }

            // Read contract source
            const contractPath = path.join(__dirname, 'contracts', 'DeviceDataStorage.sol');
            const source = await fs.readFile(contractPath, 'utf8');

            // Prepare compiler input
            const input = {
                language: 'Solidity',
                sources: {
                    'DeviceDataStorage.sol': {
                        content: source
                    }
                },
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 200
                    },
                    evmVersion: 'london',
                    outputSelection: {
                        '*': {
                            '*': ['abi', 'evm.bytecode']
                        }
                    }
                }
            };

            // Compile contract
            const output = JSON.parse(solc.compile(JSON.stringify(input)));
            
            // Check for compilation errors
            if (!output.contracts || !output.contracts['DeviceDataStorage.sol'] || !output.contracts['DeviceDataStorage.sol']['DeviceDataStorage']) {
                console.error('Compilation output:', JSON.stringify(output, null, 2));
                throw new Error('Contract compilation failed');
            }

            const contractOutput = output.contracts['DeviceDataStorage.sol']['DeviceDataStorage'];
            if (!contractOutput.abi || !contractOutput.evm || !contractOutput.evm.bytecode || !contractOutput.evm.bytecode.object) {
                throw new Error('Invalid contract output structure');
            }

            // Get contract data
            const abi = contractOutput.abi;
            const bytecode = contractOutput.evm.bytecode.object;

            // Create contract instance
            const contractInstance = new this.web3.eth.Contract(abi);
            
            // Prepare deployment
            const deploy = contractInstance.deploy({
                data: bytecode.startsWith('0x') ? bytecode : '0x' + bytecode
            });

            // Make sure we have the account set
            if (!this.defaultAccount) {
                const accounts = await this.web3.eth.getAccounts();
                this.defaultAccount = accounts[0];
            }

            // Estimate gas
            const estimatedGas = await deploy.estimateGas({ from: this.defaultAccount });
            const gasLimit = BigInt(Math.floor(Number(estimatedGas) * 1.2)); // Add 20% buffer
            
            // Get the current nonce for this account
            const nonce = await this.web3.eth.getTransactionCount(this.defaultAccount);
            console.log(`Using account ${this.defaultAccount} with nonce: ${nonce}`);
            
            // Deploy contract with explicit nonce
            const deployOptions = {
                from: this.defaultAccount,
                gas: gasLimit,
                nonce: nonce // Add explicit nonce
            };
            
            console.log('Sending deployment transaction...');
            const deployedContract = await deploy.send(deployOptions);
            console.log('Contract deployment confirmed');

            this.contract = deployedContract;
            this.contractAddress = deployedContract.options.address;
            
            // Save the contract address and ABI for later use
            await fs.writeFile(
                path.join(__dirname, 'contract-address.json'),
                JSON.stringify({
                    address: deployedContract.options.address,
                    abi: deployedContract.options.jsonInterface
                }, null, 2)
            );
            
            console.log('Contract deployed at:', this.contractAddress);
            return true;
        } catch (error) {
            console.error('Failed to compile and deploy contract:', error);
            return false;
        }
    }

    async storeDeviceData(deviceId, dataHash) {
        if (!this.contract) {
            throw new Error('Contract not initialized');
        }

        try {
            const gasLimit = BigInt(200000);
            await this.contract.methods.storeData(deviceId, dataHash).send({
                from: this.defaultAccount,
                gas: gasLimit
            });
            return true;
        } catch (error) {
            console.error('Failed to store device data on blockchain:', error);
            return false;
        }
    }

    async deviceDataExists(deviceId) {
        if (!this.contract) {
            return false;
        }

        try {
            const count = await this.contract.methods.getDataCount(deviceId).call();
            return Number(count) > 0;
        } catch (error) {
            return false;
        }
    }

    async getLatestDeviceData(deviceId) {
        if (!this.contract) {
            return null;
        }

        // Check if data exists before trying to retrieve it
        const exists = await this.deviceDataExists(deviceId);
        if (!exists) {
            return null;
        }

        try {
            const result = await this.contract.methods.getLatestData(deviceId).call();
            return {
                dataHash: result[0],
                timestamp: Number(result[1])
            };
        } catch (error) {
            // Only log the error if it's not a "No data exists" error
            if (error.message && !error.message.includes('No data exists for this device')) {
                console.error('Failed to get latest device data from blockchain:', error);
            }
            return null;
        }
    }

    async getHistoricalDeviceData(deviceId, index) {
        if (!this.contract) {
            throw new Error('Contract not initialized');
        }

        try {
            const result = await this.contract.methods.getHistoricalData(deviceId, index).call();
            return {
                dataHash: result[0],
                timestamp: Number(result[1])
            };
        } catch (error) {
            console.error('Failed to get historical device data from blockchain:', error);
            return null;
        }
    }

    async getDeviceDataInRange(deviceId, startTime, endTime) {
        if (!this.contract) {
            throw new Error('Contract not initialized');
        }

        try {
            const result = await this.contract.methods.getDataInTimeRange(deviceId, startTime, endTime).call();
            return result[0].map((hash, index) => ({
                dataHash: hash,
                timestamp: Number(result[1][index])
            }));
        } catch (error) {
            console.error('Failed to get device data range from blockchain:', error);
            return [];
        }
    }

    async getDeviceDataCount(deviceId) {
        if (!this.contract) {
            throw new Error('Contract not initialized');
        }

        try {
            const count = await this.contract.methods.getDataCount(deviceId).call();
            return Number(count);
        } catch (error) {
            console.error('Failed to get device data count from blockchain:', error);
            return 0;
        }
    }

    /**
     * Retrieves all device IDs that have data stored on the blockchain
     * by analyzing historical events
     * @returns {Promise<string[]>} Array of device IDs
     */
    async getAllDeviceIds() {
        if (!this.contract || !this.initialized) {
            throw new Error('Contract not initialized');
        }

        try {
            console.log('Scanning blockchain for all device IDs...');
            
            // Get all DataStored events from the beginning of the blockchain
            const events = await this.contract.getPastEvents('DataStored', {
                fromBlock: 0,
                toBlock: 'latest'
            });
            
            // Extract unique device IDs from events
            const deviceIds = [...new Set(events.map(event => event.returnValues.deviceId))];
            console.log(`Found ${deviceIds.length} unique devices on blockchain`);
            
            return deviceIds;
        } catch (error) {
            console.error('Failed to retrieve device IDs from blockchain:', error);
            return [];
        }
    }
}

module.exports = new BlockchainManager();
