// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

contract DeviceDataStorage {
    struct DeviceData {
        string dataHash;      // IPFS hash of the complete data
        uint256 timestamp;
        bool exists;
    }
    
    // Mapping from device ID to array of data entries
    mapping(string => DeviceData[]) private deviceData;
    
    // Mapping to track the latest data entry for each device
    mapping(string => uint256) private latestDataIndex;
    
    event DataStored(string deviceId, string dataHash, uint256 timestamp);

    // Store data hash for a device
    function storeData(string memory deviceId, string memory dataHash) public {
        DeviceData memory newData = DeviceData({
            dataHash: dataHash,
            timestamp: block.timestamp,
            exists: true
        });
        
        deviceData[deviceId].push(newData);
        latestDataIndex[deviceId] = deviceData[deviceId].length - 1;
        
        emit DataStored(deviceId, dataHash, block.timestamp);
    }
    
    // Get latest data for a device
    function getLatestData(string memory deviceId) public view returns (string memory dataHash, uint256 timestamp) {
        require(deviceData[deviceId].length > 0, "No data exists for this device");
        
        uint256 latest = latestDataIndex[deviceId];
        DeviceData memory data = deviceData[deviceId][latest];
        
        return (data.dataHash, data.timestamp);
    }
    
    // Get historical data for a device
    function getHistoricalData(string memory deviceId, uint256 index) public view returns (string memory dataHash, uint256 timestamp) {
        require(index < deviceData[deviceId].length, "Index out of bounds");
        
        DeviceData memory data = deviceData[deviceId][index];
        require(data.exists, "No data exists at this index");
        
        return (data.dataHash, data.timestamp);
    }
    
    // Get number of entries for a device
    function getDataCount(string memory deviceId) public view returns (uint256) {
        return deviceData[deviceId].length;
    }
    
    // Get data entries within a time range
    function getDataInTimeRange(
        string memory deviceId,
        uint256 startTime,
        uint256 endTime
    ) public view returns (string[] memory hashes, uint256[] memory timestamps) {
        uint256 count = 0;
        
        // First count matching entries
        for (uint256 i = 0; i < deviceData[deviceId].length; i++) {
            DeviceData memory data = deviceData[deviceId][i];
            if (data.timestamp >= startTime && data.timestamp <= endTime) {
                count++;
            }
        }
        
        // Then create arrays of correct size
        hashes = new string[](count);
        timestamps = new uint256[](count);
        
        // Fill arrays with matching entries
        uint256 index = 0;
        for (uint256 i = 0; i < deviceData[deviceId].length; i++) {
            DeviceData memory data = deviceData[deviceId][i];
            if (data.timestamp >= startTime && data.timestamp <= endTime) {
                hashes[index] = data.dataHash;
                timestamps[index] = data.timestamp;
                index++;
            }
        }
        
        return (hashes, timestamps);
    }
}
