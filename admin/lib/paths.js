const path = require('path');
const os = require('os');
const { app } = require('electron');

const PRODUCT = 'Waterboys';

function isPackaged() {
  return app && app.isPackaged;
}

function serverDir() {
  if (isPackaged()) return path.join(process.resourcesPath, 'server');
  return path.resolve(__dirname, '..', '..', 'server');
}

function serverEntry() {
  return path.join(serverDir(), 'server.js');
}

function configDir() {
  if (process.platform === 'win32') {
    const programData = process.env.PROGRAMDATA || 'C:\\ProgramData';
    return path.join(programData, PRODUCT);
  }
  return path.join(os.homedir(), '.waterboys');
}

function configFile() {
  return path.join(configDir(), 'config.json');
}

function logsDir() {
  return path.join(configDir(), 'logs');
}

function cloudflaredHome() {
  return path.join(os.homedir(), '.cloudflared');
}

function cloudflaredConfigYml() {
  return path.join(cloudflaredHome(), 'config.yml');
}

function cloudflaredCert() {
  return path.join(cloudflaredHome(), 'cert.pem');
}

module.exports = {
  PRODUCT,
  isPackaged,
  serverDir,
  serverEntry,
  configDir,
  configFile,
  logsDir,
  cloudflaredHome,
  cloudflaredConfigYml,
  cloudflaredCert
};
