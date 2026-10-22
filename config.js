// Platinum +1 Club - page configuration.
// dataUrl is the Apps Script web app URL (filled in after deployment).
// Leave dataUrl empty to run on the built-in sample data (sample.json).
window.CONTEST_CONFIG = {
  name: 'Platinum +1 Club',
  dataUrl: 'https://script.google.com/macros/s/AKfycbz9HfhX-Xb_JmhfRE4Pf8ppzuBaus2GZch9GQ-psnHx9PAwenvbK0I6_9cK-acBGPWO/exec',
  oneSignalAppId: '2c15edd1-bd5b-4f74-b3e7-64b1f7cd4c43',
  swScope: '/contest-standings/',
  swPath: 'contest-standings/OneSignalSDKWorker.js',
  pollMs: 60000
};
