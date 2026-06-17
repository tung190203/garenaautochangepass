const fs = require('fs');

const msgText = '"\\u003cbody style=\\"box-sizing: border-box; margin: 0;\\"\\u003e\\u003cimg alt=\\"\\" src=\\"https://tracking.security.garena.com/tracking/1/open/\\u003e \\u003cmeta name=\\"x-apple-disable-message-reformatting\\"\\u003e \\u003cimg data-sp-type=\\"sp-image\\" data-sp-editable=\\"true\\" id=\\"ik7fe\\" src=\\"http://f.shopee.sg/file/sg-11134004-7r98o-m31wjlaidnqgcd\\" class=\\"sp-image\\"\\u003e \\u003cdiv\\u003ePlease enter the verification code: \\u003cb\\u003e99709316 \\u003c/b\\u003ein Account Center.\\u003c/div\\u003e"';

let plainText = msgText;
try {
    const msgData = JSON.parse(msgText);
    let rawHtml = msgText;
    if (typeof msgData === 'string') {
        rawHtml = msgData;
    } else {
        rawHtml = msgData.html || msgData.body || msgData.content || msgText;
    }
    plainText = rawHtml.replace(/<[^>]*>?/gm, ''); // Xóa toàn bộ thẻ HTML
} catch (e) {
    plainText = msgText.replace(/<[^>]*>?/gm, '');
}

console.log("Extracted code:");
const matches = plainText.match(/\b\d{8}\b/g);
console.log(matches);

