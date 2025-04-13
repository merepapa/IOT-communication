const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const blockchain = require('./blockchain');

// Storage directory for device data
const STORAGE_DIR = path.join(__dirname, 'data');
const DEVICES_DIR = path.join(STORAGE_DIR, 'devices');
const REGISTRY_FILE = path.join(STORAGE_DIR, 'device_registry.json');

class StorageManager {
    constructor() {
        this.ensureDirectoriesExist();
        this.initializingBlockchain = false;
        this.blockchainInitialized = false;
        this.deviceRegistry = new Set();
        this.initializeBlockchain();
        this.loadDeviceRegistry();
    }

    async initializeBlockchain() {
        // Prevent duplicate initialization
        if (this.initializingBlockchain) return;
        this.initializingBlockchain = true;
        
        try {
            const success = await blockchain.initialize();
            this.blockchainInitialized = success;
            console.log('Blockchain integration initialized');
        } catch (error) {
            console.error('Failed to initialize blockchain:', error);
            this.blockchainInitialized = false;
        } finally {
            this.initializingBlockchain = false;
        }
    }

    generateDataHash(data) {
        const stringData = JSON.stringify(data);
        return crypto.createHash('sha256').update(stringData).digest('hex');
    }

    async ensureDirectoriesExist() {
        try {
            await fs.mkdir(STORAGE_DIR, { recursive: true });
            await fs.mkdir(DEVICES_DIR, { recursive: true });
        } catch (error) {
            console.error('Error creating storage directories:', error);
        }
    }

    async loadDeviceRegistry() {
        try {
            // Create registry file if it doesn't exist
            if (!await this.fileExists(REGISTRY_FILE)) {
                await fs.writeFile(REGISTRY_FILE, JSON.stringify({ devices: [] }));
            }
            
            const data = await fs.readFile(REGISTRY_FILE, 'utf8');
            const registry = JSON.parse(data);
            
            // Initialize the registry with known devices
            this.deviceRegistry = new Set(registry.devices);
            
            // Add any local devices not in registry
            const localDevices = await this.getLocalDeviceFolders();
            localDevices.forEach(deviceId => this.deviceRegistry.add(deviceId));
            
            // Save the updated registry
            await this.saveDeviceRegistry();
            
            console.log(`Device registry loaded with ${this.deviceRegistry.size} devices`);
        } catch (error) {
            console.error('Failed to load device registry:', error);
            this.deviceRegistry = new Set();
        }
    }

    async saveDeviceRegistry() {
        try {
            const registry = {
                devices: Array.from(this.deviceRegistry),
                lastUpdated: new Date().toISOString()
            };
            await fs.writeFile(REGISTRY_FILE, JSON.stringify(registry, null, 2));
        } catch (error) {
            console.error('Failed to save device registry:', error);
        }
    }

    async syncDeviceRegistryWithBlockchain() {
        if (!this.blockchainInitialized) return;
        
        try {
            console.log('Syncing device registry with blockchain...');
            
            // Get all device IDs from blockchain
            const blockchainDevices = await blockchain.getAllDeviceIds();
            
            // Add them to the registry
            let newDevicesFound = 0;
            blockchainDevices.forEach(deviceId => {
                if (!this.deviceRegistry.has(deviceId)) {
                    this.deviceRegistry.add(deviceId);
                    newDevicesFound++;
                }
            });
            
            if (newDevicesFound > 0) {
                console.log(`Added ${newDevicesFound} new devices from blockchain to registry`);
                await this.saveDeviceRegistry();
            } else {
                console.log('No new devices found on blockchain');
            }
        } catch (error) {
            console.error('Failed to sync device registry with blockchain:', error);
        }
    }

    async fileExists(filePath) {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    async getLocalDeviceFolders() {
        try {
            return await fs.readdir(DEVICES_DIR);
        } catch (error) {
            return [];
        }
    }

    async saveDeviceData(deviceId, data) {
        try {
            const deviceDir = path.join(DEVICES_DIR, deviceId);
            await fs.mkdir(deviceDir, { recursive: true });

            const timestamp = new Date().toISOString();
            const stateData = {
                timestamp,
                data
            };

            // Save latest state
            const stateFile = path.join(deviceDir, 'latest.json');
            await fs.writeFile(stateFile, JSON.stringify(stateData, null, 2));

            // Generate hash and store on blockchain
            if (this.blockchainInitialized) {
                try {
                    const dataHash = this.generateDataHash(stateData);
                    
                    // Save a copy of the data with the hash as reference
                    const hashMapFile = path.join(deviceDir, 'hash_map.json');
                    let hashMap = {};
                    try {
                        const hashMapData = await fs.readFile(hashMapFile, 'utf8');
                        hashMap = JSON.parse(hashMapData);
                    } catch (error) {
                        // File doesn't exist or is corrupted, start fresh
                    }
                    
                    // Store mapping of hash to data
                    hashMap[dataHash] = { timestamp };
                    await fs.writeFile(hashMapFile, JSON.stringify(hashMap, null, 2));
                    
                    // Store the full data object for this hash
                    await fs.writeFile(
                        path.join(deviceDir, `hash_${dataHash}.json`),
                        JSON.stringify(stateData, null, 2)
                    );
                    
                    const success = await blockchain.storeDeviceData(deviceId, dataHash);
                    if (success) {
                        console.log(`Data for device ${deviceId} stored on blockchain`);
                    } else {
                        console.log(`Data for device ${deviceId} pending blockchain storage`);
                    }
                } catch (error) {
                    // Don't log the whole error, just a more user-friendly message
                    console.log(`Failed to store data on blockchain for device ${deviceId}: ${error.message}`);
                }
            }

            // Save accelerometer data to history
            if (data.accelerometer) {
                const historyFile = path.join(deviceDir, 'accelerometer_history.json');
                let history = [];
                try {
                    const historyData = await fs.readFile(historyFile, 'utf8');
                    history = JSON.parse(historyData);
                } catch (error) {
                    // File doesn't exist or is corrupted, start fresh
                }

                history.push({
                    timestamp: new Date().toISOString(),
                    ...data.accelerometer
                });

                // Keep last 1000 readings
                if (history.length > 1000) {
                    history = history.slice(history.length - 1000);
                }

                await fs.writeFile(historyFile, JSON.stringify(history, null, 2));
            }

            // Save location data to history
            if (data.location) {
                const historyFile = path.join(deviceDir, 'location_history.json');
                let history = [];
                try {
                    const historyData = await fs.readFile(historyFile, 'utf8');
                    history = JSON.parse(historyData);
                } catch (error) {
                    // File doesn't exist or is corrupted, start fresh
                }

                history.push({
                    timestamp: new Date().toISOString(),
                    ...data.location
                });

                // Keep last 1000 locations
                if (history.length > 1000) {
                    history = history.slice(history.length - 1000);
                }

                await fs.writeFile(historyFile, JSON.stringify(history, null, 2));
            }

            // Save latest camera image if present
            if (data.camera && data.camera.image) {
                const imageFile = path.join(deviceDir, 'latest_image.jpg');
                const imageBuffer = Buffer.from(data.camera.image, 'base64');
                await fs.writeFile(imageFile, imageBuffer);
            }
        } catch (error) {
            console.error(`Error saving device data for ${deviceId}:`, error);
        }
    }

    async getAllDevices() {
        try {
            // Ensure registry is up to date
            await this.syncDeviceRegistryWithBlockchain();
            
            // Get all local devices first
            const localDevices = await this.getLocalDeviceFolders();
            const localDeviceData = await Promise.all(localDevices.map(async (deviceId) => {
                try {
                    const stateFile = path.join(DEVICES_DIR, deviceId, 'latest.json');
                    if (await this.fileExists(stateFile)) {
                        const stateData = await fs.readFile(stateFile, 'utf8');
                        return {
                            deviceId,
                            ...JSON.parse(stateData),
                            storageLocation: 'local'
                        };
                    }
                    return null;
                } catch (error) {
                    return null;
                }
            }));
            
            // Collect the device IDs we already have local data for
            const localDeviceIds = new Set(localDevices);
            
            // Add blockchain-only devices
            const blockchainOnlyDevices = await Promise.all(
                Array.from(this.deviceRegistry)
                    .filter(deviceId => !localDeviceIds.has(deviceId))
                    .map(async (deviceId) => {
                        try {
                            const latestData = await blockchain.getLatestDeviceData(deviceId);
                            if (latestData) {
                                // Convert blockchain timestamp to ISO string
                                const timestamp = new Date(latestData.timestamp * 1000).toISOString();
                                return {
                                    deviceId,
                                    timestamp,
                                    storageLocation: 'blockchain'
                                };
                            }
                            return null;
                        } catch (error) {
                            return null;
                        }
                    })
            );
            
            // Combine local and blockchain-only devices
            return [...localDeviceData, ...blockchainOnlyDevices].filter(d => d !== null);
        } catch (error) {
            console.error('Error getting all devices:', error);
            return [];
        }
    }

    async getDeviceHistory(deviceId) {
        try {
            const deviceDir = path.join(DEVICES_DIR, deviceId);
            
            // Try to read from local storage first
            const localData = {
                accelerometer: await this.readJsonFile(path.join(deviceDir, 'accelerometer_history.json')),
                locations: await this.readJsonFile(path.join(deviceDir, 'location_history.json')),
                latestImage: null,
                dataSource: {
                    accelerometer: 'local',
                    locations: 'local',
                    latestImage: 'local'
                }
            };

            // Try to get the latest image
            try {
                const imageFile = path.join(deviceDir, 'latest_image.jpg');
                const imageBuffer = await fs.readFile(imageFile);
                localData.latestImage = imageBuffer.toString('base64');
            } catch (error) {
                localData.latestImage = null;
                localData.dataSource.latestImage = 'unavailable';
            }
            
            // If we're missing local data and blockchain is initialized, try to get it from blockchain
            if (this.blockchainInitialized) {
                // If no local accelerometer data, try blockchain
                if (!localData.accelerometer || localData.accelerometer.length === 0) {
                    console.log(`🔍 No local accelerometer data for device ${deviceId}, attempting blockchain retrieval...`);
                    const blockchainAccel = await this.getAccelerometerFromBlockchain(deviceId);
                    if (blockchainAccel && blockchainAccel.length > 0) {
                        localData.accelerometer = blockchainAccel;
                        localData.dataSource.accelerometer = 'blockchain';
                        console.log(`✅ Successfully restored ${blockchainAccel.length} accelerometer records from blockchain for ${deviceId}`);
                    } else {
                        console.log(`⚠️ No accelerometer data found on blockchain for device ${deviceId}`);
                    }
                }
                
                // If no local location data, try blockchain
                if (!localData.locations || localData.locations.length === 0) {
                    console.log(`🔍 No local location data for device ${deviceId}, attempting blockchain retrieval...`);
                    const blockchainLocations = await this.getLocationsFromBlockchain(deviceId);
                    if (blockchainLocations && blockchainLocations.length > 0) {
                        localData.locations = blockchainLocations;
                        localData.dataSource.locations = 'blockchain';
                        console.log(`✅ Successfully restored ${blockchainLocations.length} location records from blockchain for ${deviceId}`);
                    } else {
                        console.log(`⚠️ No location data found on blockchain for device ${deviceId}`);
                    }
                }
                
                // If no local image, try blockchain
                if (!localData.latestImage) {
                    console.log(`🔍 No local image for device ${deviceId}, attempting blockchain retrieval...`);
                    const blockchainImage = await this.getImageFromBlockchain(deviceId);
                    if (blockchainImage) {
                        localData.latestImage = blockchainImage;
                        localData.dataSource.latestImage = 'blockchain';
                        console.log(`✅ Successfully restored camera image from blockchain for ${deviceId}`);
                    } else {
                        console.log(`⚠️ No camera image found on blockchain for ${deviceId}`);
                    }
                }
            }

            // Add placeholder data detection
            const isPlaceholderData = {
                accelerometer: localData.accelerometer.some(item => item._restoredFromBlockchain),
                locations: localData.locations.some(item => item._restoredFromBlockchain)
            };
            
            localData.isPlaceholderData = isPlaceholderData;
            
            return localData;
        } catch (error) {
            console.error(`Error getting device history for ${deviceId}:`, error);
            return null;
        }
    }
    
    async getAccelerometerFromBlockchain(deviceId) {
        try {
            // Get the last 30 days of data
            const endTime = Math.floor(Date.now() / 1000);
            const startTime = endTime - (30 * 24 * 60 * 60); // 30 days back
            
            const blockchainData = await blockchain.getDeviceDataInRange(deviceId, startTime, endTime);
            if (!blockchainData || blockchainData.length === 0) {
                return [];
            }
            
            const results = [];
            for (const data of blockchainData) {
                try {
                    // Try to retrieve the full device data from hash
                    const deviceData = await this.getDeviceDataFromHash(deviceId, data.dataHash);
                    if (deviceData && deviceData.data && deviceData.data.accelerometer) {
                        results.push({
                            timestamp: deviceData.timestamp,
                            ...deviceData.data.accelerometer
                        });
                    }
                } catch (err) {
                    console.error(`Error processing blockchain data for ${deviceId}:`, err);
                }
            }
            
            return results;
        } catch (error) {
            console.error(`Error getting accelerometer from blockchain for ${deviceId}:`, error);
            return [];
        }
    }
    
    async getLocationsFromBlockchain(deviceId) {
        try {
            // Get the last 30 days of data
            const endTime = Math.floor(Date.now() / 1000);
            const startTime = endTime - (30 * 24 * 60 * 60); // 30 days back
            
            const blockchainData = await blockchain.getDeviceDataInRange(deviceId, startTime, endTime);
            if (!blockchainData || blockchainData.length === 0) {
                return [];
            }
            
            const results = [];
            for (const data of blockchainData) {
                try {
                    // Try to retrieve the full device data from hash
                    const deviceData = await this.getDeviceDataFromHash(deviceId, data.dataHash);
                    if (deviceData && deviceData.data && deviceData.data.location) {
                        results.push({
                            timestamp: deviceData.timestamp,
                            ...deviceData.data.location
                        });
                    }
                } catch (err) {
                    console.error(`Error processing blockchain location for ${deviceId}:`, err);
                }
            }
            
            return results;
        } catch (error) {
            console.error(`Error getting locations from blockchain for ${deviceId}:`, error);
            return [];
        }
    }
    
    async getImageFromBlockchain(deviceId) {
        try {
            // Try to get latest data from blockchain
            const latestData = await blockchain.getLatestDeviceData(deviceId);
            if (!latestData) {
                return null;
            }
            
            // Try to retrieve the full device data from hash
            const deviceData = await this.getDeviceDataFromHash(deviceId, latestData.dataHash);
            if (deviceData && deviceData.data && deviceData.data.camera && deviceData.data.camera.image) {
                return deviceData.data.camera.image;
            }
            return null;
        } catch (error) {
            console.error(`Error getting image from blockchain for ${deviceId}:`, error);
            return null;
        }
    }
    
    async getDeviceDataFromHash(deviceId, dataHash) {
        try {
            // First try to find this hash in our local storage
            const deviceDir = path.join(DEVICES_DIR, deviceId);
            const hashMapFile = path.join(deviceDir, 'hash_map.json');
            
            let hashMap = {};
            try {
                const hashMapData = await fs.readFile(hashMapFile, 'utf8');
                hashMap = JSON.parse(hashMapData);
            } catch (error) {
                // File doesn't exist or is corrupted, start fresh
                hashMap = {};
            }
            
            // If we have this hash stored locally, use that data
            if (hashMap[dataHash]) {
                const dataFile = path.join(deviceDir, `hash_${dataHash}.json`);
                try {
                    const storedData = await fs.readFile(dataFile, 'utf8');
                    return JSON.parse(storedData);
                } catch (err) {
                    // Hash map entry exists but file is missing or corrupted
                    delete hashMap[dataHash];
                    await fs.writeFile(hashMapFile, JSON.stringify(hashMap, null, 2));
                }
            }
            
            // If we get here, we couldn't restore the data for this hash
            return null;
        } catch (error) {
            console.error(`Error retrieving device data from hash for ${deviceId}:`, error);
            return null;
        }
    }

    async restoreDeviceFromBlockchain(deviceId) {
        try {
            console.log(`🔄 Starting restoration of device ${deviceId} from blockchain...`);
            
            if (!this.blockchainInitialized) {
                throw new Error('Blockchain not initialized');
            }
            
            // First check if the device exists on the blockchain
            const exists = await blockchain.deviceDataExists(deviceId);
            if (!exists) {
                throw new Error('No data for this device on blockchain');
            }
            
            // Create device directory if it doesn't exist
            const deviceDir = path.join(DEVICES_DIR, deviceId);
            await fs.mkdir(deviceDir, { recursive: true });
            console.log(`✅ Created device directory: ${deviceDir}`);
            
            // Initialize hash map file
            const hashMapFile = path.join(deviceDir, 'hash_map.json');
            const hashMap = {};
            
            // Get all device data from blockchain (last 30 days)
            const endTime = Math.floor(Date.now() / 1000);
            const startTime = endTime - (30 * 24 * 60 * 60); // 30 days back
            
            const blockchainData = await blockchain.getDeviceDataInRange(deviceId, startTime, endTime);
            console.log(`📥 Retrieved ${blockchainData.length} data points from blockchain`);
            
            if (blockchainData.length > 0) {
                // Process each data point
                const accelerometerData = [];
                const locationData = [];
                let latestStateData = null;
                let latestTimestamp = 0;
                
                for (const data of blockchainData) {
                    // Add entry to hash map
                    const timestamp = new Date(data.timestamp * 1000).toISOString();
                    hashMap[data.dataHash] = { timestamp };
                    
                    // Create synthetic data for this hash - mark it as restored from blockchain
                    const syntheticData = {
                        timestamp,
                        data: {
                            accelerometer: { 
                                x: 0, y: 0, z: 0, 
                                timestamp,
                                _restoredFromBlockchain: true // Flag to mark this as placeholder data
                            },
                            location: { 
                                latitude: 0, longitude: 0,
                                _restoredFromBlockchain: true
                            },
                            lastUpdate: timestamp
                        },
                        _restoredFromBlockchain: true
                    };
                    
                    // Save hash data file
                    await fs.writeFile(
                        path.join(deviceDir, `hash_${data.dataHash}.json`),
                        JSON.stringify(syntheticData, null, 2)
                    );
                    
                    // Track latest data
                    if (data.timestamp > latestTimestamp) {
                        latestTimestamp = data.timestamp;
                        latestStateData = syntheticData;
                    }
                    
                    // Add to history collections with placeholder flag
                    accelerometerData.push({ 
                        timestamp, 
                        x: 0, y: 0, z: 0,
                        _restoredFromBlockchain: true
                    });
                    locationData.push({ 
                        timestamp, 
                        latitude: 0, longitude: 0,
                        _restoredFromBlockchain: true 
                    });
                }
                
                // Save hash map
                await fs.writeFile(hashMapFile, JSON.stringify(hashMap, null, 2));
                console.log(`✅ Created hash map with ${Object.keys(hashMap).length} entries`);
                
                // Save latest state
                if (latestStateData) {
                    await fs.writeFile(
                        path.join(deviceDir, 'latest.json'),
                        JSON.stringify(latestStateData, null, 2)
                    );
                    console.log(`✅ Saved latest state data`);
                }
                
                // Save accelerometer history
                await fs.writeFile(
                    path.join(deviceDir, 'accelerometer_history.json'),
                    JSON.stringify(accelerometerData, null, 2)
                );
                
                // Save location history
                await fs.writeFile(
                    path.join(deviceDir, 'location_history.json'),
                    JSON.stringify(locationData, null, 2)
                );
                
                console.log(`✅ Device ${deviceId} restored with placeholder data from blockchain!`);
                console.log(`⚠️ Note: Actual data content couldn't be restored, only timestamps and structure`);
                return { success: true, isPlaceholder: true };
            } else {
                console.log(`⚠️ No recent data found on blockchain for device ${deviceId}`);
                return { success: false };
            }
        } catch (error) {
            console.error(`Failed to restore device ${deviceId} from blockchain:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Delete a device from local storage and optionally from the registry
     * @param {string} deviceId The device ID to delete
     * @param {boolean} removeFromRegistry Whether to remove from device registry
     * @returns {Promise<Object>} Result of the operation
     */
    async deleteDevice(deviceId) {
        try {
            const deviceDir = path.join(DEVICES_DIR, deviceId);
            
            // Check if device directory exists
            if (await this.fileExists(deviceDir)) {
                // Get list of files
                const files = await fs.readdir(deviceDir);
                console.log(`Found ${files.length} files to delete for device ${deviceId}`);
                
                // Delete all files in the device directory
                for (const file of files) {
                    await fs.unlink(path.join(deviceDir, file));
                }
                
                // Remove the directory itself
                await fs.rmdir(deviceDir);
                console.log(`✅ Deleted device directory for ${deviceId}`);
                
                // Remove from registry if requested
                this.deviceRegistry.delete(deviceId);
                await this.saveDeviceRegistry();
                console.log(`✅ Removed device ${deviceId} from registry`);
                
                return { success: true };
            } else {
                // If directory doesn't exist, just remove from registry
                this.deviceRegistry.delete(deviceId);
                await this.saveDeviceRegistry();
                console.log(`✅ Removed non-existent device ${deviceId} from registry`);
                return { success: true, message: 'Device removed from registry, no local data found' };
            }
        } catch (error) {
            console.error(`Failed to delete device ${deviceId}:`, error);
            return { success: false, error: error.message };
        }
    }

    async readJsonFile(filePath) {
        try {
            const data = await fs.readFile(filePath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            return [];
        }
    }
}

module.exports = new StorageManager();
