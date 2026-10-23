// Platinum +1 Club - page configuration.
// One file serves both sites. The test site (mrg0114.github.io/contest-standings-test/) is detected
// from the address, so the same code can be promoted to the live site without edits.
(function () {
  var TEST = location.pathname.indexOf('/contest-standings-test/') === 0;
  window.CONTEST_CONFIG = {
    name: 'Platinum +1 Club',
    version: '2.0',
    env: TEST ? 'test' : 'live',
    // Scoring feed (Apps Script web app). Read-only, so the test site reads the live standings.
    dataUrl: 'https://script.google.com/macros/s/AKfycbz9HfhX-Xb_JmhfRE4Pf8ppzuBaus2GZch9GQ-psnHx9PAwenvbK0I6_9cK-acBGPWO/exec',
    // Push notifications stay off on the test site so test activity never reaches real subscribers.
    oneSignalAppId: TEST ? '' : '2c15edd1-bd5b-4f74-b3e7-64b1f7cd4c43',
    swScope: '/contest-standings/',
    swPath: 'contest-standings/OneSignalSDKWorker.js',
    pollMs: 60000,
    // The Paddock message board (its own Apps Script web app). Empty hides the Paddock.
    paddockUrl: TEST ? '' : '',
    // Sponsor banner at the bottom of the page. Set logo to the approved file (for example
    // 'assets/plex-logo.svg', the light version for dark backgrounds) once Plex supplies it;
    // until then the banner shows the name in text.
    sponsor: { name: 'Plex', url: 'https://www.plex.tv', label: 'plex.tv', logo: '' }
  };
})();
