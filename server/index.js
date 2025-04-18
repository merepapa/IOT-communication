const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const storage = require('./storage');
const blockchain = require('./blockchain');
const crypto = require('crypto');
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Enable CORS
app.use(cors());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Store connected clients
const clients = new Map();

wss.on('connection', (ws) => {
    let deviceId = null;

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            
            // Special handling for camera data
            if (data.type === 'camera') {
                console.log('📸 Received camera frame from client');
                
                // If deviceId is already known for this connection, use it
                // Otherwise try to find it
                if (!deviceId) {
                    deviceId = getDeviceId(ws);
                }
                
                if (deviceId) {
                    // Get the client object directly from the map
                    const client = clients.get(deviceId);
                    if (client) {
                        // Update the client's data with camera information
                        if (!client.data) {
                            client.data = {};
                        }
                        
                        // Store camera data
                        client.data.camera = {
                            image: data.image,
                            timestamp: data.timestamp
                        };
                        client.data.lastUpdate = new Date();
                        
                        console.log(`✅ Camera data updated for device ${deviceId.substring(0, 6)}, image size: ${data.image.length}`);
                        
                        // Broadcast updated device list to all clients
                        broadcastConnectedDevices();
                    } else {
                        console.warn(`⚠️ Client not found for device ID: ${deviceId}`);
                    }
                } else {
                    console.warn('⚠️ Received camera data from unregistered device');
                }
                
                return; // Stop processing this message
            }

            if (data.type === 'register') {
                deviceId = data.deviceId;
                clients.set(deviceId, {
                    ws,
                    lastUpdate: new Date(),
                    data: {}
                });
                broadcastConnectedDevices();
            } else if (data.type === 'update' && deviceId) {
                const client = clients.get(deviceId);
                if (client) {
                    client.data = {
                        ...client.data,
                        ...data.payload,
                    };
                    client.data.lastUpdate = new Date();
                    await storage.saveDeviceData(deviceId, client.data);
                    broadcastConnectedDevices();
                }
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });

    ws.on('close', () => {
        if (deviceId) {
            clients.delete(deviceId);
            broadcastConnectedDevices();
        }
    });
});

/**
 * Gets the device ID associated with a WebSocket connection
 * @param {WebSocket} websocket The WebSocket connection to find
 * @returns {string|null} The device ID or null if not found
 */
function getDeviceId(websocket) {
    for (const [id, client] of clients.entries()) {
        if (client.ws === websocket) {
            return id;
        }
    }
    return null;
}

function broadcastConnectedDevices() {
    const devices = Array.from(clients.entries()).map(([id, client]) => ({
        deviceId: id,
        lastUpdate: client.data.lastUpdate,
        data: client.data
    }));

    const message = JSON.stringify({
        type: 'devices',
        devices
    });

    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Blockchain verification endpoints
app.get('/api/blockchain/status', async (req, res) => {
    try {
        const contract = blockchain.contract;
        if (!contract) {
            res.json({ status: 'not_connected' });
            return;
        }
        res.json({ 
            status: 'connected',
            address: blockchain.contractAddress
        });
    } catch (error) {
        console.error('Error getting blockchain status:', error);
        res.status(500).json({ error: 'Failed to get blockchain status' });
    }
});

app.get('/api/blockchain/verify/:deviceId', async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        
        // First check if the device has any data on blockchain at all
        const hasBlockchainData = await blockchain.deviceDataExists(deviceId);
        
        if (!hasBlockchainData) {
            return res.json({
                verified: false,
                status: 'pending',
                message: 'No blockchain data exists for this device yet'
            });
        }
        
        // Get data from local storage
        const deviceDir = path.join(__dirname, 'data', 'devices', deviceId);
        const stateFile = path.join(deviceDir, 'latest.json');
        
        if (!await fileExists(stateFile)) {
            return res.json({ 
                verified: false, 
                status: 'error',
                message: 'No local data found' 
            });
        }
        
        const stateData = JSON.parse(await fs.readFile(stateFile, 'utf8'));

        // Generate hash of the data
        const dataHash = crypto.createHash('sha256')
            .update(JSON.stringify(stateData))
            .digest('hex');

        // Get blockchain data
        const blockchainData = await blockchain.getLatestDeviceData(deviceId);
        
        // Compare hashes - handle case when no blockchain data yet
        if (!blockchainData) {
            res.json({
                verified: false,
                status: 'pending',
                localHash: dataHash,
                blockchainHash: null,
                message: 'Data pending blockchain verification'
            });
            return;
        }
        
        const verified = blockchainData.dataHash === dataHash;
        
        res.json({
            verified,
            status: verified ? 'verified' : 'mismatch',
            localHash: dataHash,
            blockchainHash: blockchainData.dataHash,
            message: verified ? 'Data verified on blockchain' : 'Data verification failed'
        });
    } catch (error) {
        console.error('Error verifying blockchain data:', error);
        res.status(500).json({ 
            error: 'Failed to verify data',
            message: error.message 
        });
    }
});

// Add new API endpoints for blockchain device discovery and restoration
app.get('/api/blockchain/devices', async (req, res) => {
    try {
        const blockchainDevices = await blockchain.getAllDeviceIds();
        res.json({ devices: blockchainDevices });
    } catch (error) {
        console.error('Error getting blockchain devices:', error);
        res.status(500).json({ error: 'Failed to get blockchain devices' });
    }
});

// Modify the restore endpoint
app.post('/api/devices/:deviceId/restore', async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        const result = await storage.restoreDeviceFromBlockchain(deviceId);
        
        if (result.success) {
            res.json({ 
                success: true, 
                message: `Device ${deviceId} successfully restored from blockchain`,
                isPlaceholder: result.isPlaceholder || false
            });
        } else {
            res.status(400).json({ 
                success: false, 
                message: result.error || 'Failed to restore device - no data found on blockchain'
            });
        }
    } catch (error) {
        console.error(`Error restoring device from blockchain:`, error);
        res.status(500).json({ 
            success: false, 
            message: `Error: ${error.message}` 
        });
    }
});

// Add deletion endpoint
app.delete('/api/devices/:deviceId', async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        console.log(`Received request to delete device: ${deviceId}`);
        
        const result = await storage.deleteDevice(deviceId);
        
        if (result.success) {
            res.json({ 
                success: true,
                message: `Device ${deviceId} successfully deleted`,
                details: result.message
            });
        } else {
            res.status(400).json({ 
                success: false, 
                message: `Failed to delete device: ${result.error}` 
            });
        }
    } catch (error) {
        console.error(`Error deleting device:`, error);
        res.status(500).json({ 
            success: false, 
            message: `Error: ${error.message}` 
        });
    }
});

// Helper function to check if a file exists
async function fileExists(path) {
    try {
        await fs.access(path);
        return true;
    } catch {
        return false;
    }
}

// Device data endpoints
app.get('/api/devices', async (req, res) => {
    const devices = await storage.getAllDevices();
    res.json(devices);
});

app.get('/api/devices/:deviceId/history', async (req, res) => {
    const history = await storage.getDeviceHistory(req.params.deviceId);
    if (history) {
        res.json(history);
    } else {
        res.status(404).json({ error: 'Device not found' });
    }
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    // Log all available IP addresses for easier connection
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    const results = {};

    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
            if (net.family === 'IPv4' && !net.internal) {
                if (!results[name]) {
                    results[name] = [];
                }
                results[name].push(net.address);
            }
        }
    }

    console.log('Server running on port', PORT);
    console.log('Available on:');
    for (const [interface, addresses] of Object.entries(results)) {
        for (const addr of addresses) {
            console.log(`  http://${addr}:${PORT}`);
        }
    }
});
