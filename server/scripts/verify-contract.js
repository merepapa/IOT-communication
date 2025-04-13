/**
 * This script verifies the connection to an existing blockchain contract
 * and can help diagnose issues with contract persistence between server restarts.
 */
const { Web3 } = require('web3');
const fs = require('fs');
const path = require('path');

async function verifyContract() {
  console.log('🔍 Verifying blockchain contract connection...');
  
  try {
    // Check if contract address file exists
    const addressFile = path.join(__dirname, '..', 'contract-address.json');
    if (!fs.existsSync(addressFile)) {
      console.error('❌ Contract address file not found at:', addressFile);
      return false;
    }
    
    console.log('✅ Found contract address file');
    
    // Read and parse contract data
    const addressData = JSON.parse(fs.readFileSync(addressFile, 'utf8'));
    if (!addressData.address || !addressData.abi) {
      console.error('❌ Invalid contract data in file:', addressData);
      return false;
    }
    
    console.log(`✅ Contract address: ${addressData.address}`);
    
    // Connect to Ganache and verify the contract
    try {
      const web3 = new Web3(new Web3.providers.HttpProvider('http://127.0.0.1:7545'));
      
      // Check connection
      const networkId = await web3.eth.net.getId();
      console.log(`✅ Connected to Ethereum network ID: ${networkId}`);
      
      // Get accounts
      const accounts = await web3.eth.getAccounts();
      if (!accounts || accounts.length === 0) {
        console.error('❌ No accounts found in Ganache');
        return false;
      }
      console.log(`✅ Found ${accounts.length} accounts in Ganache`);
      
      // Create contract instance
      const contract = new web3.eth.Contract(
        addressData.abi,
        addressData.address
      );
      
      // Try to call a method to verify the contract
      try {
        // Call getDataCount which should work even with no data
        const result = await contract.methods.getDataCount('test').call();
        console.log(`✅ Contract verified! getDataCount('test') returned: ${result}`);
        return true;
      } catch (callError) {
        console.error('❌ Failed to call contract method:', callError.message);
        
        // Check if contract exists at the address
        const code = await web3.eth.getCode(addressData.address);
        if (code === '0x' || code === '0x0') {
          console.error('❌ No contract found at address. The blockchain might have been reset.');
        } else {
          console.log('✅ Contract code exists at address');
          console.error('❌ But method call failed, contract interface might be incompatible');
        }
        return false;
      }
    } catch (web3Error) {
      console.error('❌ Failed to connect to Ganache:', web3Error.message);
      console.log('❓ Is Ganache running at http://127.0.0.1:7545?');
      return false;
    }
  } catch (error) {
    console.error('❌ Unexpected error during verification:', error);
    return false;
  }
}

// Run the verification
verifyContract().then(success => {
  if (success) {
    console.log('\n✅✅✅ Contract verification SUCCESSFUL ✅✅✅');
    console.log('You should be able to restart the server and keep your blockchain data.');
  } else {
    console.log('\n❌❌❌ Contract verification FAILED ❌❌❌');
    console.log('Check the error messages above for more details.');
    console.log('\nPossible solutions:');
    console.log('1. Make sure Ganache is running and accessible at http://127.0.0.1:7545');
    console.log('2. If Ganache was restarted or a new workspace was created, you need to delete contract-address.json to deploy a new contract');
    console.log('3. Check if the contract ABI in contract-address.json matches the current smart contract code');
  }
});
