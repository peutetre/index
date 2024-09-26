const fs = require('node:fs/promises');
const xml2js = require('xml2js');
const { parseArgs } = require('node:util');
var googleapis = require("googleapis");
const { promisify } = require('util');
const sleep = promisify(setTimeout);
const crypto = require('crypto');

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
      return Promise.reject(`Failed to index on bing`);
    } else {
      console.log(`bing indexed ✔️ `);
      return Promise.resolve();
    }
  });
}



async function submitToGoogle(urls, client_email, private_key) {
  const auth = new googleapis.google.auth.JWT(
    client_email,
    null,
    private_key,
    ['https://www.googleapis.com/auth/indexing'],
    null
  );

  console.log("Attempting to authenticate...");
  try {
    await auth.authorize();
    console.log("Authentication successful.");
  } catch (error) {
    console.error("Authentication failed:", error);
    throw error;
  }

  const submitBatch = async (batch) => {
    const boundary = '===============' + crypto.randomBytes(8).toString('hex') + '==';
    const body = batch.map((url, index) => `
--${boundary}
Content-Type: application/http
Content-Transfer-Encoding: binary
Content-ID: <item${index + 1}>

POST /v3/urlNotifications:publish
Content-Type: application/json
accept: application/json

{"url":"${url}","type":"URL_UPDATED"}
`).join('\n') + `\n--${boundary}--`;

    try {
      const response = await fetch('https://indexing.googleapis.com/batch', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${auth.credentials.access_token}`,
          'Content-Type': `multipart/mixed; boundary=${boundary}`
        },
        body: body
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
      }

      const responseText = await response.text();
      if (debug) {
        console.log('Batch response:', responseText);
      }

      const successCount = (responseText.match(/HTTP\/1\.1 200 OK/g) || []).length;
      console.log(`Successfully submitted ${successCount}/${batch.length} URLs`);
    } catch (error) {
      console.error(`Error submitting batch:`, error.message);
    }

    // Add a delay between batches to avoid hitting rate limits
    await new Promise(r => setTimeout(r, 1000));  // 1 second delay, adjust as needed
  };

  const processAllBatches = async () => {
    for (let i = 0; i < urls.length; i += batchSize) {
      const batch = urls.slice(i, i + batchSize);
      await submitBatch(batch);
      console.log(`Processed batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(urls.length / batchSize)}`);
    }
  };

  await processAllBatches();
  return urls;
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
