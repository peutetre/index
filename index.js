/*
 * index.js
 */

const fs = require('node:fs/promises');
const xml2js = require('xml2js');
const { parseArgs } = require('node:util');
var googleapis = require("googleapis");


const options = {
  'google': { type: 'boolean' },
  'bing': { type: 'boolean' },
  'sitemap': { type: 'string' },
};


const { values, tokens } = parseArgs({ options, tokens: true });


tokens.filter((token) => token.kind === 'option')
  .forEach((token) => {
    values[token.name] = token.value ?? true;
  });


const sitemap = values.sitemap ?? 'sitemap.xml';
const google = values.google ?? false;
const bing = values.bing ?? false;


function parseSitemap(s) {
  var parser = new xml2js.Parser();
  return fs.readFile(s, { encoding: 'utf8' }).then(function (data) {
    return parser.parseStringPromise(data).then(function (result) {
      return result.urlset.url.map(url => url.loc[0]);
    });
  });
}


function submitToBing(urls, key, keyloc) {
  var host = (new URL(urls[0])).origin;
  var data = {
    "host": host,
    "key": key,
    "keyLocation": keyloc,
    "urlList": urls
  };

  return fetch('https://api.indexnow.org', {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(data)
  }).then((res) => {
    if(res.status != 200) {
      console.log(res.text())
      return reject(`Failed to index on bing`);
    } else {
      console.log(`bing indexed ✔️ `);
      return Promise.resolve();
    }
  });
}


function submitToGoogle(urls, client_email, private_key) {

  const jwtClient = new googleapis.google.auth.JWT(
    client_email,
    null,
    private_key,
    ["https://www.googleapis.com/auth/indexing"],
    null
  );

  return new Promise(function (resolve, reject) {
    jwtClient.authorize(function (err, tokens) {
      if (err) {
        return reject(err);
      }

      urls.reduce(function (acc, u) {
        return acc.then(function () {
          return fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + tokens.access_token
            },
            body: JSON.stringify({
              url: u,
              type: 'URL_UPDATED'
            })
          }).then(function (res) {
            if(res.status != 200) {
              return reject(`Failed to index ${u}`);
            } else {
              console.log(`${u} ✔️ `);
              return Promise.resolve();
            }
          });
        });
      }, Promise.resolve()).then(function () {
        resolve(urls);
      });
    });
  });
}


function show(urls) {
  console.log(urls.join('\n'));
  console.log(`${urls.length} elements`);
  return Promise.resolve(urls);
}


parseSitemap(sitemap).then(show).then(function (locs) {
  if(bing) {
    try {
      var infos = require('./bing.json');
    } catch (err) {
      return Promise.reject(err);
    }
    if(!infos.key)
      return Promise.reject('key needed');
    if(!infos.keyloc)
      return Promise.reject('keyloc needed');
    return submitToBing(locs, infos.key, infos.keyloc).then(() => locs);
  } else {
    return Promise.resolve(locs);
  }
}, function (err) {
  console.log(err.message);
}).then(function (locs) {
  if(google) {
    try {
      var infos = require('./google.json');
    } catch (err) {
      return Promise.reject(err);
    }
    if(!infos.client_email)
      return Promise.reject('client_email needed');
    if(!infos.private_key)
      return Promise.reject('private_key needed');
    return submitToGoogle(locs, infos.client_email, infos.private_key).then(() => locs);
  } else {
    return Promise.resolve(locs);
  }
}, function (err) {
  console.log(err.message);
});
