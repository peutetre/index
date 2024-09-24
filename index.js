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
  'debug': { type: 'boolean' },  // New debug option
  'batchSize': { type: 'string' },
};

const { values, tokens } = parseArgs({ options, tokens: true });

tokens.filter((token) => token.kind === 'option')
  .forEach((token) => {
    values[token.name] = token.value ?? true;
  });

const sitemap = values.sitemap ?? null;
const google = values.google ?? false;
const bing = values.bing ?? false;
const debug = values.debug ?? false;  // New debug flag
const batchSize = parseInt(values.batchSize ?? "100", 10);  // Default batch size is 100



function parseSitemap(s) {
  return fetch(s, {
    method: "GET"
  }).then((res) => {
    if(res.status != 200) {
      return Promise.reject(`Failed to fetch sitemap`);
    } else {
      return Promise.resolve(res.text());
    }
  }).then(function (txt) {
    var parser = new xml2js.Parser();
    return parser.parseStringPromise(txt).then(function (result) {
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
        console.error("Authentication error:", err);
        return reject(err);
      }

      console.log("Authentication successful. Access token acquired.");

      const processBatch = async (batch) => {
        const body = {
          urls: batch.map(url => ({
            type: "URL_UPDATED",
            url: url
          }))
        };

        try {
          // Using the correct API endpoint
          const res = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + tokens.access_token
            },
            body: JSON.stringify(body)
          });

          const contentType = res.headers.get("content-type");
          if (contentType && contentType.indexOf("application/json") !== -1) {
            const responseData = await res.json();
            if (res.status !== 200) {
              console.error(`Failed to index batch. Status: ${res.status}, Response:`, responseData);
            } else {
              if (debug) {
                console.log(`Batch submission response:`, responseData);
              } else {
                console.log(`Successfully submitted batch of ${batch.length} URLs`);
              }
            }
          } else {
            const textResponse = await res.text();
            console.error(`Received non-JSON response. Status: ${res.status}, Content-Type: ${contentType}`);
            console.error(`Response body (first 500 characters):`);
            console.error(textResponse.substring(0, 500));
          }
        } catch (error) {
          console.error(`Error indexing batch:`, error);
          if (error.response) {
            console.error(`Response status:`, error.response.status);
            console.error(`Response headers:`, error.response.headers);
          }
        }

        // Add a small delay between batches to avoid hitting rate limits
        await new Promise(r => setTimeout(r, 1000));
      };

      const processAllBatches = async () => {
        for (let i = 0; i < urls.length; i += batchSize) {
          const batch = urls.slice(i, i + batchSize);
          await processBatch(batch);
          console.log(`Processed batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(urls.length / batchSize)}`);
        }
      };

      processAllBatches()
        .then(() => resolve(urls))
        .catch(reject);
    });
  });
}


function show(urls) {
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
      console.error("Error reading google.json:", err);
      return Promise.reject(err);
    }
    if(!infos.client_email) {
      console.error("client_email is missing in google.json");
      return Promise.reject('client_email needed');
    }
    if(!infos.private_key) {
      console.error("private_key is missing in google.json");
      return Promise.reject('private_key needed');
    }
    console.log("Credentials loaded successfully. Attempting to submit URLs to Google.");
    return submitToGoogle(locs, infos.client_email, infos.private_key).then(() => locs);
  } else {
    return Promise.resolve(locs);
  }
}, function (err) {
  if (debug) {
    console.error('Error:', err);
  } else {
    console.log(err.message);
  }
});

// If debug mode is on, log any unhandled promise rejections
if (debug) {
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // If the reason is an error with a response property, log more details
    if (reason.response) {
      console.error('Response status:', reason.response.status);
      console.error('Response headers:', reason.response.headers);
      reason.response.text().then(text => {
        console.error('Response body:', text);
      });
    }
  });
}
