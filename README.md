# TheComm - IoT Monitoring Platform

TheComm is a comprehensive IoT monitoring platform that enables real-time tracking, visualization, and secure storage of device data. This system combines local data storage with blockchain verification to ensure data integrity and provides recovery options for device information.

## Features

- **Real-time Device Monitoring**: View sensor data from connected devices as it arrives
- **Data Visualization**: See locations on interactive maps and sensor readings through dynamic charts
- **Historical Data Analysis**: Review past device data with detailed graphs and maps
- **Blockchain Integration**: Verify data integrity and recover device information
- **Multi-sensor Support**: Track accelerometer data, GPS coordinates, and camera images
- **Android Client**: Mobile application for collecting and transmitting sensor data

## System Architecture

### Server
- Node.js backend for data processing and storage
- WebSocket connections for real-time data updates
- Blockchain integration for data verification and backup
- Web interface for monitoring and analysis

### Client
- Android application built with Kotlin and Jetpack Compose
- Sensor data collection (accelerometer, GPS, camera)
- Real-time data transmission to server

## Data Flow Architecture

### 1. Data Collection (Android Client)
- Android sensors (accelerometer, GPS) continuously collect environmental data
- Data is packaged into structured `SensorMessage` objects with device ID and timestamp
- Camera captures images when triggered by the application
- Collection frequency is optimized for battery efficiency and data relevance

### 2. Data Transmission
- WebSocket connection established between Android client and Node.js server
- Data transmitted in JSON format over secure WebSocket protocol
- Connection status monitored and displayed to user
- Automatic reconnection attempts on connection loss

### 3. Server Processing
- Server receives incoming sensor data via WebSocket connection
- Data is validated for format and completeness
- Each device is identified by unique ID and tracked in device registry
- Timestamps added to incoming data for temporal tracking

### 4. Data Storage (Dual-layer)
- **Primary Storage (Local):**
  - Structured JSON storage in filesystem
  - Separate files for different data types (accelerometer_history.json, location_history.json)
  - Latest state stored in latest.json for quick access
  - Image data stored as base64-encoded files
  
- **Secondary Storage (Blockchain):**
  - Data hash generated using SHA-256 algorithm
  - Hash + timestamp recorded on Ethereum blockchain via smart contract
  - Original data mapped to its hash in local hash_map.json
  - Creates immutable, tamper-proof record of data existence

### 5. Data Verification
- System compares local data hash with blockchain-stored hash
- Verification status displayed in UI (verified, pending, mismatch)
- Alerts generated for data integrity violations
- Hash mapping enables quick verification of historical data points

### 6. Data Visualization
- Real-time dashboard shows current readings from all connected devices
- Interactive maps display device locations using Leaflet.js
- Chart.js generates time-series graphs of accelerometer data
- Expandable/collapsible device cards for focused monitoring

### 7. Historical Analysis
- Complete timeline of device data accessible through history page
- Filtering and sorting capabilities for data exploration
- Tab-based interface separates different sensor types
- Source indicators show whether data is from local storage or blockchain

### 8. Data Recovery
- If local data is corrupted or lost, blockchain serves as recovery mechanism
- System retrieves data hashes from blockchain
- Reconstructs device history timeline from available hashes
- Creates placeholder data structures when only verification data is available

### Data Flow Diagram
```
┌─────────────┐        WebSocket        ┌──────────────┐        ┌─────────────────┐
│             │ ───────────────────────>│              │        │                 │
│  Android    │  Sensor Data (JSON)     │   Node.js    │───────>│  Local Storage  │
│  Client     │<─────────────────────── │   Server     │        │  (JSON Files)   │
│             │  Status/Confirmations   │              │        │                 │
└─────────────┘                         └───────┬──────┘        └─────────────────┘
                                               │
                                               │ Data Hashes
                                               ▼
┌─────────────┐                         ┌──────────────┐
│             │                         │              │
│   Web UI    │<────────────────────────│   Ethereum   │
│  Dashboard  │  Verification Status    │  Blockchain  │
│             │                         │              │
└─────────────┘                         └──────────────┘
```

## Setup and Installation

### Server Requirements
1. Node.js (v12+)
2. Ethereum blockchain access (local or testnet. i used Ganache)
3. Solidity compiler

### Server Setup
```bash
# Clone the repository
git clone https://github.com/merepapa/IOT-communication

# Navigate to server directory
cd TheComm/server

# Install dependencies
npm install

# Start the server
node index.js
```

### Android Client Setup
1. Open the project in Android Studio
2. Update the WebSocket server address in MainActivity.kt
3. Build and install on Android device (minimum SDK 26)

## Usage

### Live Monitoring
Open `http://server-address:3000/` to view the real-time dashboard showing all connected devices and their current sensor readings.

### Historical Data
1. Navigate to `http://server-address:3000/history.html` to access historical device data
2. Select a device to view detailed history
3. Switch between location history, accelerometer data, and camera images using the tabs

### Data Recovery
If a device's local data is lost, you can restore it from the blockchain:
1. Go to the History page
2. Find devices marked with "Blockchain Only"
3. Click "Restore from Blockchain"

## Security Features

- Data hashing for integrity verification
- Blockchain storage of critical data points
- Verification status indicators for data authenticity
