const fs = require('fs');
const pngToIco = require('png-to-ico').default;

pngToIco('assets/icon.png')
  .then(buf => {
    fs.writeFileSync('assets/icon.ico', buf);
    console.log('Successfully converted icon.png to icon.ico');
  })
  .catch(console.error);
