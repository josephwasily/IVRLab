#!/usr/bin/env node
/**
 * IP Address Update Script for IVR-Lab
 * 
 * Updates the external IP address across all configuration files and database.
 * 
 * Usage:
 *   node update-ip.js                    # Auto-detect current IP
 *   node update-ip.js 192.168.1.100      # Set specific IP
 *   node update-ip.js --help             # Show help
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

// Files that need IP updates
const CONFIG_FILES = [
  {
    path: 'asterisk/pjsip.conf',
    patterns: [
      /external_media_address=[\d.]+/g,
      /external_signaling_address=[\d.]+/g
    ],
    replacements: (ip) => [
      `external_media_address=${ip}`,
      `external_signaling_address=${ip}`
    ]
  },
  {
    path: 'sbc/docker-compose.yml',
    patterns: [
      /--external-ip=[\d.]+/g
    ],
    replacements: (ip) => [
      `--external-ip=${ip}`
    ]
  },
  {
    path: '.env.example',
    patterns: [
      /EXTERNAL_IP=[\d.]+/g
    ],
    replacements: (ip) => [
      `EXTERNAL_IP=${ip}`
    ]
  },
  {
    path: '.env',
    patterns: [
      /EXTERNAL_IP=[\d.]+/g
    ],
    replacements: (ip) => [
      `EXTERNAL_IP=${ip}`
    ],
    optional: true
  },
  {
    path: 'platform-api/src/scripts/setup-survey.js',
    patterns: [
      /'[\d.]+',\s*\/\/ Asterisk host/g,
      /'(192\.168\.[\d.]+)',/g
    ],
    replacements: (ip) => [
      `'${ip}', // Asterisk host`,
      `'${ip}',`
    ]
  }
];

// Get the primary LAN IP address
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip internal (loopback) and non-IPv4 addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        // Prefer 192.168.x.x addresses
        if (iface.address.startsWith('192.168.')) {
          return iface.address;
        }
      }
    }
  }
  
  // Fallback: return first non-internal IPv4
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  
  return null;
}

// Validate IP address format
function isValidIP(ip) {
  const regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!regex.test(ip)) return false;
  
  const parts = ip.split('.');
  return parts.every(part => {
    const num = parseInt(part, 10);
    return num >= 0 && num <= 255;
  });
}

// Update a single file
function updateFile(config, newIP, rootDir) {
  const filePath = path.join(rootDir, config.path);
  
  if (!fs.existsSync(filePath)) {
    if (config.optional) {
      console.log(`  ⏭️  ${config.path} (not found, skipping)`);
      return { skipped: true };
    }
    console.log(`  ❌ ${config.path} (not found)`);
    return { error: 'File not found' };
  }
  
  let content = fs.readFileSync(filePath, 'utf8');
  const originalContent = content;
  
  const replacements = config.replacements(newIP);
  
  config.patterns.forEach((pattern, index) => {
    content = content.replace(pattern, replacements[index] || replacements[0]);
  });
  
  if (content !== originalContent) {
    fs.writeFileSync(filePath, content);
    console.log(`  ✅ ${config.path}`);
    return { updated: true };
  } else {
    console.log(`  ⏭️  ${config.path} (no changes needed)`);
    return { unchanged: true };
  }
}

// Update SIP trunk in database via API
async function updateDatabase(newIP) {
  try {
    // Try to login and update trunk
    const http = require('http');
    
    const loginData = JSON.stringify({
      email: 'admin@demo.com',
      password: 'admin123'
    });
    
    // Login
    const token = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: 'localhost',
        port: 3001,
        path: '/api/auth/login',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': loginData.length
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json.token);
          } catch (e) {
            reject(new Error('Failed to parse login response'));
          }
        });
      });
      req.on('error', reject);
      req.write(loginData);
      req.end();
    });
    
    if (!token) {
      console.log('  ⚠️  Database: Could not authenticate');
      return { skipped: true };
    }
    
    // Get trunks
    const trunks = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: 'localhost',
        port: 3001,
        path: '/api/trunks',
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Failed to parse trunks response'));
          }
        });
      });
      req.on('error', reject);
      req.end();
    });
    
    // Update each trunk that has old IP
    let updated = 0;
    for (const trunk of trunks) {
      if (trunk.host && trunk.host.startsWith('192.168.')) {
        const updateData = JSON.stringify({ host: newIP });
        
        await new Promise((resolve, reject) => {
          const req = http.request({
            hostname: 'localhost',
            port: 3001,
            path: `/api/trunks/${trunk.id}`,
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
              'Content-Length': updateData.length
            }
          }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve());
          });
          req.on('error', reject);
          req.write(updateData);
          req.end();
        });
        
        updated++;
      }
    }
    
    if (updated > 0) {
      console.log(`  ✅ Database: Updated ${updated} SIP trunk(s)`);
      return { updated: true };
    } else {
      console.log('  ⏭️  Database: No trunks needed updating');
      return { unchanged: true };
    }
    
  } catch (error) {
    console.log(`  ⚠️  Database: ${error.message} (API may not be running)`);
    return { skipped: true };
  }
}

// Restart containers
function restartContainers() {
  console.log('\n🔄 Restarting containers...');
  
  try {
    execSync('docker compose restart asterisk', { 
      stdio: 'inherit',
      cwd: path.dirname(process.argv[1]) || process.cwd()
    });
    console.log('  ✅ Asterisk restarted');
  } catch (error) {
    console.log('  ⚠️  Could not restart Asterisk (Docker may not be running)');
  }
}

// Main function
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
IVR-Lab IP Address Update Script

Usage:
  node update-ip.js                    Auto-detect and set current LAN IP
  node update-ip.js <ip-address>       Set a specific IP address
  node update-ip.js --help             Show this help

Files Updated:
  - asterisk/pjsip.conf                External media/signaling addresses
  - sbc/docker-compose.yml             RTPEngine external IP
  - .env.example                       Environment template
  - .env                               Environment file (if exists)
  - platform-api/src/scripts/          Setup scripts
  - Database                           SIP trunk host (via API)

After Update:
  - Asterisk container is automatically restarted
  - Update your softphone to use the new IP address
`);
    return;
  }
  
  // Determine the new IP
  let newIP;
  
  if (args.length > 0 && isValidIP(args[0])) {
    newIP = args[0];
  } else if (args.length > 0) {
    console.error(`❌ Invalid IP address: ${args[0]}`);
    process.exit(1);
  } else {
    newIP = getLocalIP();
    if (!newIP) {
      console.error('❌ Could not detect local IP address. Please provide one manually.');
      process.exit(1);
    }
  }
  
  const rootDir = path.dirname(process.argv[1]) || process.cwd();
  
  console.log(`\n🌐 IVR-Lab IP Address Update`);
  console.log(`   New IP: ${newIP}`);
  console.log(`   Root:   ${rootDir}\n`);
  
  // Update configuration files
  console.log('📁 Updating configuration files...');
  
  let filesUpdated = 0;
  let filesSkipped = 0;
  let filesError = 0;
  
  for (const config of CONFIG_FILES) {
    const result = updateFile(config, newIP, rootDir);
    if (result.updated) filesUpdated++;
    else if (result.skipped || result.unchanged) filesSkipped++;
    else if (result.error) filesError++;
  }
  
  // Update database
  console.log('\n💾 Updating database...');
  await updateDatabase(newIP);
  
  // Restart containers
  restartContainers();
  
  // Summary
  console.log(`
✨ Update Complete!

📋 Summary:
   - Files updated: ${filesUpdated}
   - Files skipped: ${filesSkipped}
   ${filesError > 0 ? `- Files with errors: ${filesError}` : ''}

📱 Next Steps:
   1. Update your softphone to connect to: ${newIP}:5060
   2. If platform-api is running, the SIP trunk is already updated
   3. If not, the trunk will be updated when you run setup-survey.js
`);
}

main().catch(console.error);
