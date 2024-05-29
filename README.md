# index your pages with Google Index API and IndexNow

## install

```
npm i
```

## config


create `google.json`

```
{
   client_email: '...',
   private_key: '...'
}

```

create `bing.json`


```
{
    "key": "...",
    "keyloc: "..."
}
```

## run


```
node index.js sitemap.xml --google --bing
```

