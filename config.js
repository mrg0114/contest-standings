// Platinum +1 Club - page configuration.
// dataUrl is the Apps Script web app URL (filled in after deployment).
// Leave dataUrl empty to run on the built-in sample data (sample.json).
window.CONTEST_CONFIG = {
  name: 'Platinum +1 Club',
  dataUrl: '',
  oneSignalAppId: '2c15edd1-bd5b-4f74-b3e7-64b1f7cd4c43',
  swScope: '/contest-standings/',
  swPath: 'contest-standings/OneSignalSDKWorker.js',
  pollMs: 60000
};
