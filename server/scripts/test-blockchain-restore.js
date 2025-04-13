/**
 * This script deletes local device data while preserving blockchain hash mappings,
 * allowing us to test the blockchain data restoration feature.
 */
const fs = require('fs').promises;
const path = require('path');

const DEVICES_DIR = path.join(__dirname, '..', 'data', 'devices');

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function testBlockchainRestore(deviceId) {
  try {
    console.log(`\n🧪 Setting up test scenario for device: ${deviceId}`);
    
    const deviceDir = path.join(DEVICES_DIR, deviceId);
    
    // Check if this device directory exists
    if (!(await fileExists(deviceDir))) {
      console.error(`❌ Device directory not found: ${deviceDir}`);
      return false;
    }
    
    // Create backup directory
    const backupDir = path.join(deviceDir, 'backup_' + Date.now().toString());
    await fs.mkdir(backupDir);
    console.log(`✅ Created backup directory: ${path.relative(DEVICES_DIR, backupDir)}`);
    
    // Files to backup and remove
    const filesToRemove = [
      'accelerometer_history.json',
      'location_history.json',
      'latest_image.jpg'
    ];
    
    // Verify hash_map.json exists (needed for blockchain restoration)
    const hashMapFile = path.join(deviceDir, 'hash_map.json');
    if (!(await fileExists(hashMapFile))) {
      console.error('❌ No hash_map.json found. This device may not have blockchain backup data.');
      return false;
    }
    
    // Backup and remove files
    for (const file of filesToRemove) {
      const filePath = path.join(deviceDir, file);
      
      if (await fileExists(filePath)) {
        // Copy to backup
        const backupPath = path.join(backupDir, file);
        await fs.copyFile(filePath, backupPath);
        
        // Remove the file
        await fs.unlink(filePath);
        console.log(`✅ Backed up and removed: ${file}`);
      } else {
        console.log(`ℹ️ File doesn't exist, skipping: ${file}`);
      }
    }
    
    console.log(`\n✨ Test scenario ready! Local data removed but blockchain references preserved.`);
    console.log(`\n📋 Testing Instructions:
1. Start your server if not already running
2. Open http://localhost:3000/history.html in your browser
3. Click on device ${deviceId.substring(0, 6)}...
4. Observe the "Blockchain Restored" indicators on the data tabs
5. Check server logs for blockchain retrieval messages`);
    
    console.log(`\n🔄 To restore all data from backup, run:
   mv ${path.join(backupDir, '*')} ${deviceDir}`);
    
    return true;
  } catch (error) {
    console.error('❌ Error setting up test scenario:', error);
    return false;
  }
}

async function listAvailableDevices() {
  try {
    const devices = await fs.readdir(DEVICES_DIR);
    
    console.log('📱 Available devices:');
    for (const deviceId of devices) {
      // Check if this device has hash_map.json (required for restoration)
      const hashMapExists = await fileExists(path.join(DEVICES_DIR, deviceId, 'hash_map.json'));
      console.log(`   ${deviceId.substring(0, 8)}... ${hashMapExists ? '(has blockchain data)' : '(no blockchain data)'}`);
    }
    
    return devices;
  } catch (error) {
    console.error('Error listing devices:', error);
    return [];
  }
}

async function main() {
  // Display banner
  console.log('\n==========================================================');
  console.log('🔄 BLOCKCHAIN DATA RESTORATION TEST');
  console.log('==========================================================');
  
  // List available devices
  const devices = await listAvailableDevices();
  
  if (devices.length === 0) {
    console.log('❌ No devices found. Make sure your server has been running and collecting data.');
    return;
  }
  
  // Use the first device with blockchain data, or allow specifying as command line argument
  const deviceToTest = process.argv[2] || devices[0];
  
  await testBlockchainRestore(deviceToTest);
}

main().catch(console.error);
