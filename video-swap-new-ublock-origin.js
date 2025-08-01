twitch-videoad.js text/javascript
(function() {
    if ( /(^|\.)twitch\.tv$/.test(document.location.hostname) === false ) { return; }
    var ourTwitchAdSolutionsVersion = 9;// Used to prevent conflicts with outdated versions of the scripts
    if (typeof unsafeWindow === 'undefined') {
        unsafeWindow = window;
    }
    if (typeof unsafeWindow.twitchAdSolutionsVersion !== 'undefined' && unsafeWindow.twitchAdSolutionsVersion >= ourTwitchAdSolutionsVersion) {
        console.log("skipping video-swap-new as there's another script active. ourVersion:" + ourTwitchAdSolutionsVersion + " activeVersion:" + unsafeWindow.twitchAdSolutionsVersion);
        unsafeWindow.twitchAdSolutionsVersion = ourTwitchAdSolutionsVersion;
        return;
    }
    unsafeWindow.twitchAdSolutionsVersion = ourTwitchAdSolutionsVersion;
    function declareOptions(scope) {
        // Options / globals
        scope.OPT_MODE_STRIP_AD_SEGMENTS = true;
        scope.OPT_MODE_NOTIFY_ADS_WATCHED = true;
        scope.OPT_MODE_NOTIFY_ADS_WATCHED_MIN_REQUESTS = false;
        scope.OPT_BACKUP_PLAYER_TYPE = 'autoplay';
        scope.OPT_BACKUP_PLATFORM = 'ios';
        scope.OPT_REGULAR_PLAYER_TYPE = 'site';
        scope.OPT_ACCESS_TOKEN_PLAYER_TYPE = null;
        scope.OPT_SHOW_AD_BANNER = true;
        scope.AD_SIGNIFIER = 'stitched-ad';
        scope.LIVE_SIGNIFIER = ',live';
        scope.CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
        // These are only really for Worker scope...
        scope.StreamInfos = [];
        scope.StreamInfosByUrl = [];
        scope.CurrentChannelNameFromM3U8 = null;
        // Need this in both scopes. Window scope needs to update this to worker scope.
        scope.gql_device_id = null;
        scope.ClientIntegrityHeader = null;
        scope.AuthorizationHeader = null;
    }
    var twitchWorkers = [];
    var workerStringConflicts = [
        'twitch',
        'isVariantA'// TwitchNoSub
    ];
    var workerStringAllow = [];
    var workerStringReinsert = [
        'isVariantA',// TwitchNoSub (prior to (0.9))
        'besuper/',// TwitchNoSub (0.9)
        '${patch_url}'// TwitchNoSub (0.9.1)
    ];
    function getCleanWorker(worker) {
        var root = null;
        var parent = null;
        var proto = worker;
        while (proto) {
            var workerString = proto.toString();
            if (workerStringConflicts.some((x) => workerString.includes(x)) && !workerStringAllow.some((x) => workerString.includes(x))) {
                if (parent !== null) {
                    Object.setPrototypeOf(parent, Object.getPrototypeOf(proto));
                }
            } else {
                if (root === null) {
                    root = proto;
                }
                parent = proto;
            }
            proto = Object.getPrototypeOf(proto);
        }
        return root;
    }
    function getWorkersForReinsert(worker) {
        var result = [];
        var proto = worker;
        while (proto) {
            var workerString = proto.toString();
            if (workerStringReinsert.some((x) => workerString.includes(x))) {
                result.push(proto);
            } else {
            }
            proto = Object.getPrototypeOf(proto);
        }
        return result;
    }
    function reinsertWorkers(worker, reinsert) {
        var parent = worker;
        for (var i = 0; i < reinsert.length; i++) {
            Object.setPrototypeOf(reinsert[i], parent);
            parent = reinsert[i];
        }
        return parent;
    }
    function isValidWorker(worker) {
        var workerString = worker.toString();
        return !workerStringConflicts.some((x) => workerString.includes(x))
            || workerStringAllow.some((x) => workerString.includes(x))
            || workerStringReinsert.some((x) => workerString.includes(x));
    }
    function hookWindowWorker() {
        var reinsert = getWorkersForReinsert(unsafeWindow.Worker);
        var newWorker = class Worker extends getCleanWorker(unsafeWindow.Worker) {
            constructor(twitchBlobUrl, options) {
                var isTwitchWorker = false;
                try {
                    isTwitchWorker = new URL(twitchBlobUrl).origin.endsWith('.twitch.tv');
                } catch {}
                if (!isTwitchWorker) {
                    super(twitchBlobUrl, options);
                    return;
                }
                var newBlobStr = `
                    const pendingFetchRequests = new Map();
                    ${processM3U8.toString()}
                    ${hookWorkerFetch.toString()}
                    ${declareOptions.toString()}
                    ${getAccessToken.toString()}
                    ${gqlRequest.toString()}
                    ${makeGraphQlPacket.toString()}
                    ${tryNotifyAdsWatchedM3U8.toString()}
                    ${parseAttributes.toString()}
                    ${onFoundAd.toString()}
                    ${getWasmWorkerJs.toString()}
                    var workerString = getWasmWorkerJs('${twitchBlobUrl.replaceAll("'", "%27")}');
                    declareOptions(self);
                    self.addEventListener('message', function(e) {
                        if (e.data.key == 'UboUpdateDeviceId') {
                            gql_device_id = e.data.value;
                        } else if (e.data.key == 'UpdateClientIntegrityHeader') {
                            ClientIntegrityHeader = e.data.value;
                        } else if (e.data.key == 'UpdateAuthorizationHeader') {
                            AuthorizationHeader = e.data.value;
                        } else if (e.data.key == 'FetchResponse') {
                            const responseData = e.data.value;
                            if (pendingFetchRequests.has(responseData.id)) {
                                const { resolve, reject } = pendingFetchRequests.get(responseData.id);
                                pendingFetchRequests.delete(responseData.id);
                                if (responseData.error) {
                                    reject(new Error(responseData.error));
                                } else {
                                    // Create a Response object from the response data
                                    const response = new Response(responseData.body, {
                                        status: responseData.status,
                                        statusText: responseData.statusText,
                                        headers: responseData.headers
                                    });
                                    resolve(response);
                                }
                            }
                        }
                    });
                    hookWorkerFetch();
                    eval(workerString);
                `
                super(URL.createObjectURL(new Blob([newBlobStr])), options);
                twitchWorkers.push(this);
                this.addEventListener('message', (e) => {
                    // NOTE: Removed adDiv caching as '.video-player' can change between streams?
                    if (e.data.key == 'UboShowAdBanner') {
                        var adDiv = getAdDiv();
                        if (adDiv != null) {
                            adDiv.P.textContent = 'Blocking' + (e.data.isMidroll ? ' midroll' : '') + ' ads';
                            if (OPT_SHOW_AD_BANNER) {
                                adDiv.style.display = 'block';
                            }
                        }
                    } else if (e.data.key == 'UboHideAdBanner') {
                        var adDiv = getAdDiv();
                        if (adDiv != null) {
                            adDiv.style.display = 'none';
                        }
                    } else if (e.data.key == 'UboChannelNameM3U8Changed') {
                        //console.log('M3U8 channel name changed to ' + e.data.value);
                    } else if (e.data.key == 'UboReloadPlayer') {
                        reloadTwitchPlayer();
                    } else if (e.data.key == 'UboPauseResumePlayer') {
                        reloadTwitchPlayer(false, true);
                    } else if (e.data.key == 'UboSeekPlayer') {
                        reloadTwitchPlayer(true);
                    }
                });
                this.addEventListener('message', async event => {
                    if (event.data.key == 'FetchRequest') {
                        const fetchRequest = event.data.value;
                        const responseData = await handleWorkerFetchRequest(fetchRequest);
                        this.postMessage({
                            key: 'FetchResponse',
                            value: responseData
                        });
                    }
                });
                function getAdDiv() {
                    var playerRootDiv = document.querySelector('.video-player');
                    var adDiv = null;
                    if (playerRootDiv != null) {
                        adDiv = playerRootDiv.querySelector('.ubo-overlay');
                        if (adDiv == null) {
                            adDiv = document.createElement('div');
                            adDiv.className = 'ubo-overlay';
                            adDiv.innerHTML = '<div class="player-ad-notice" style="color: white; background-color: rgba(0, 0, 0, 0.8); position: absolute; top: 0px; left: 0px; padding: 5px;"><p></p></div>';
                            adDiv.style.display = 'none';
                            adDiv.P = adDiv.querySelector('p');
                            playerRootDiv.appendChild(adDiv);
                        }
                    }
                    return adDiv;
                }
            }
        }
        var workerInstance = reinsertWorkers(newWorker, reinsert);
        Object.defineProperty(unsafeWindow, 'Worker', {
            get: function() {
                return workerInstance;
            },
            set: function(value) {
                if (isValidWorker(value)) {
                    workerInstance = value;
                } else {
                    console.log('Attempt to set twitch worker denied');
                }
            }
        });
    }
    function getWasmWorkerJs(twitchBlobUrl) {
        var req = new XMLHttpRequest();
        req.open('GET', twitchBlobUrl, false);
        req.overrideMimeType("text/javascript");
        req.send();
        return req.responseText;
    }
    function onFoundAd(streamInfo, textStr, reloadPlayer) {
        console.log('Found ads, switch to backup');
        streamInfo.UseBackupStream = true;
        streamInfo.IsMidroll = textStr.includes('"MIDROLL"') || textStr.includes('"midroll"');
        if (reloadPlayer) {
            postMessage({key:'UboReloadPlayer'});
        }
        postMessage({key:'UboShowAdBanner',isMidroll:streamInfo.IsMidroll});
    }
    async function processM3U8(url, textStr, realFetch) {
        var streamInfo = StreamInfosByUrl[url];
        if (streamInfo == null) {
            console.log('Unknown stream url ' + url);
            //postMessage({key:'UboHideAdBanner'});
            return textStr;
        }
        if (!OPT_MODE_STRIP_AD_SEGMENTS) {
            return textStr;
        }
        var haveAdTags = textStr.includes(AD_SIGNIFIER);
        if (streamInfo.UseBackupStream) {
            if (streamInfo.Encodings == null) {
                console.log('Found backup stream but not main stream?');
                streamInfo.UseBackupStream = false;
                postMessage({key:'UboReloadPlayer'});
                return '';
            } else {
                var streamM3u8Url = streamInfo.Encodings.match(/^https:.*\.m3u8$/m)[0];
                var streamM3u8Response = await realFetch(streamM3u8Url);
                if (streamM3u8Response.status == 200) {
                    var streamM3u8 = await streamM3u8Response.text();
                    if (streamM3u8 != null) {
                        if (!streamM3u8.includes(AD_SIGNIFIER)) {
                            console.log('No more ads on main stream. Triggering player reload to go back to main stream...');
                            streamInfo.UseBackupStream = false;
                            postMessage({key:'UboHideAdBanner'});
                            postMessage({key:'UboReloadPlayer'});
                        } else if (!streamM3u8.includes('"MIDROLL"') && !streamM3u8.includes('"midroll"')) {
                            var lines = streamM3u8.replace('\r', '').split('\n');
                            for (var i = 0; i < lines.length; i++) {
                                var line = lines[i];
                                if (line.startsWith('#EXTINF') && lines.length > i + 1) {
                                    if (!line.includes(LIVE_SIGNIFIER) && !streamInfo.RequestedAds.has(lines[i + 1])) {
                                        // Only request one .ts file per .m3u8 request to avoid making too many requests
                                        //console.log('Fetch ad .ts file');
                                        streamInfo.RequestedAds.add(lines[i + 1]);
                                        fetch(lines[i + 1]).then((response)=>{response.blob()});
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } else if (haveAdTags) {
            onFoundAd(streamInfo, textStr, true);
        } else {
            postMessage({key:'UboHideAdBanner'});
        }
        if (haveAdTags && streamInfo.BackupEncodings != null) {
            var streamM3u8Url = streamInfo.BackupEncodings.match(/^https:.*\.m3u8.*$/m)[0];
            var streamM3u8Response = await realFetch(streamM3u8Url);
            if (streamM3u8Response.status == 200) {
                textStr = await streamM3u8Response.text();
            }
        }
        return textStr;
    }
    function hookWorkerFetch() {
        console.log('hookWorkerFetch (video-swap-new)');
        var realFetch = fetch;
        fetch = async function(url, options) {
            if (typeof url === 'string') {
                url = url.trimEnd();
                if (url.endsWith('m3u8')) {
                    return new Promise(function(resolve, reject) {
                        var processAfter = async function(response) {
                            var str = await processM3U8(url, await response.text(), realFetch);
                            resolve(new Response(str, {
                                status: response.status,
                                statusText: response.statusText,
                                headers: response.headers
                            }));
                        };
                        var send = function() {
                            return realFetch(url, options).then(function(response) {
                                processAfter(response);
                            })['catch'](function(err) {
                                console.log('fetch hook err ' + err);
                                reject(err);
                            });
                        };
                        send();
                    });
                }
                else if (url.includes('/api/channel/hls/') && !url.includes('picture-by-picture')) {
                    var channelName = (new URL(url)).pathname.match(/([^\/]+)(?=\.\w+$)/)[0];
                    if (CurrentChannelNameFromM3U8 != channelName) {
                        postMessage({
                            key: 'UboChannelNameM3U8Changed',
                            value: channelName
                        });
                    }
                    CurrentChannelNameFromM3U8 = channelName;
                    if (OPT_MODE_STRIP_AD_SEGMENTS) {
                        return new Promise(async function(resolve, reject) {
                            // - First m3u8 request is the m3u8 with the video encodings (360p,480p,720p,etc).
                            // - Second m3u8 request is the m3u8 for the given encoding obtained in the first request. At this point we will know if there's ads.
                            var streamInfo = StreamInfos[channelName];
                            if (streamInfo != null && streamInfo.Encodings != null && (await realFetch(streamInfo.Encodings.match(/^https:.*\.m3u8$/m)[0])).status !== 200) {
                                // The cached encodings are dead (the stream probably restarted)
                                streamInfo = null;
                            }
                            if (streamInfo == null || streamInfo.Encodings == null || streamInfo.BackupEncodings == null) {
                                StreamInfos[channelName] = streamInfo = {
                                    RequestedAds: new Set(),
                                    Encodings: null,
                                    BackupEncodings: null,
                                    IsMidroll: false,
                                    UseBackupStream: false,
                                    ChannelName: channelName
                                };
                                for (var i = 0; i < 2; i++) {
                                    var encodingsUrl = url;
                                    if (i == 1) {
                                        var accessTokenResponse = await getAccessToken(channelName, OPT_BACKUP_PLAYER_TYPE, OPT_BACKUP_PLATFORM);
                                        if (accessTokenResponse != null && accessTokenResponse.status === 200) {
                                            var accessToken = await accessTokenResponse.json();
                                            var urlInfo = new URL('https://usher.ttvnw.net/api/channel/hls/' + channelName + '.m3u8' + (new URL(url)).search);
                                            urlInfo.searchParams.set('sig', accessToken.data.streamPlaybackAccessToken.signature);
                                            urlInfo.searchParams.set('token', accessToken.data.streamPlaybackAccessToken.value);
                                            encodingsUrl = urlInfo.href;
                                        } else {
                                            resolve(accessTokenResponse);
                                            return;
                                        }
                                    }
                                    var encodingsM3u8Response = await realFetch(encodingsUrl, options);
                                    if (encodingsM3u8Response != null && encodingsM3u8Response.status === 200) {
                                        var encodingsM3u8 = await encodingsM3u8Response.text();
                                        if (i == 0) {
                                            streamInfo.Encodings = encodingsM3u8;
                                            var streamM3u8Url = encodingsM3u8.match(/^https:.*\.m3u8$/m)[0];
                                            var streamM3u8Response = await realFetch(streamM3u8Url);
                                            if (streamM3u8Response.status == 200) {
                                                var streamM3u8 = await streamM3u8Response.text();
                                                if (streamM3u8.includes(AD_SIGNIFIER)) {
                                                    onFoundAd(streamInfo, streamM3u8, false);
                                                }
                                            } else {
                                                resolve(streamM3u8Response);
                                                return;
                                            }
                                        } else {
                                            var lowResLines = encodingsM3u8.replace('\r', '').split('\n');
                                            var lowResBestUrl = null;
                                            for (var j = 0; j < lowResLines.length; j++) {
                                                if (lowResLines[j].startsWith('#EXT-X-STREAM-INF')) {
                                                    var res = parseAttributes(lowResLines[j])['RESOLUTION'];
                                                    if (res && lowResLines[j + 1].endsWith('.m3u8')) {
                                                        // Assumes resolutions are correctly ordered
                                                        lowResBestUrl = lowResLines[j + 1];
                                                        break;
                                                    }
                                                }
                                            }
                                            if (lowResBestUrl != null && streamInfo.Encodings != null) {
                                                var normalEncodingsM3u8 = streamInfo.Encodings;
                                                var normalLines = normalEncodingsM3u8.replace('\r', '').split('\n');
                                                for (var j = 0; j < normalLines.length - 1; j++) {
                                                    if (normalLines[j].startsWith('#EXT-X-STREAM-INF')) {
                                                        var res = parseAttributes(normalLines[j])['RESOLUTION'];
                                                        if (res) {
                                                            lowResBestUrl += ' ';// The stream doesn't load unless each url line is unique
                                                            normalLines[j + 1] = lowResBestUrl;
                                                        }
                                                    }
                                                }
                                                encodingsM3u8 = normalLines.join('\r\n');
                                            }
                                            streamInfo.BackupEncodings = encodingsM3u8;
                                        }
                                        var lines = encodingsM3u8.replace('\r', '').split('\n');
                                        for (var j = 0; j < lines.length; j++) {
                                            if (!lines[j].startsWith('#') && lines[j].includes('.m3u8')) {
                                                StreamInfosByUrl[lines[j].trimEnd()] = streamInfo;
                                            }
                                        }
                                    } else {
                                        resolve(encodingsM3u8Response);
                                        return;
                                    }
                                }
                            }
                            if (streamInfo.UseBackupStream) {
                                resolve(new Response(streamInfo.BackupEncodings));
                            } else {
                                resolve(new Response(streamInfo.Encodings));
                            }
                        });
                    }
                }
            }
            return realFetch.apply(this, arguments);
        }
    }
    function makeGraphQlPacket(event, radToken, payload) {
        return [{
            operationName: 'ClientSideAdEventHandling_RecordAdEvent',
            variables: {
                input: {
                    eventName: event,
                    eventPayload: JSON.stringify(payload),
                    radToken,
                },
            },
            extensions: {
                persistedQuery: {
                    version: 1,
                    sha256Hash: '7e6c69e6eb59f8ccb97ab73686f3d8b7d85a72a0298745ccd8bfc68e4054ca5b',
                },
            },
        }];
    }
    function getAccessToken(channelName, playerType, platform) {
        if (!platform) {
            platform = 'web';
        }
        var body = null;
        var templateQuery = 'query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) {  streamPlaybackAccessToken(channelName: $login, params: {platform: "' + platform + '", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) {    value    signature    __typename  }  videoPlaybackAccessToken(id: $vodID, params: {platform: "' + platform + '", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isVod) {    value    signature    __typename  }}';
        body = {
            operationName: 'PlaybackAccessToken_Template',
            query: templateQuery,
            variables: {
                'isLive': true,
                'login': channelName,
                'isVod': false,
                'vodID': '',
                'playerType': playerType
            }
        };
        return gqlRequest(body);
    }
    function gqlRequest(body) {
        if (!gql_device_id) {
            const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
            for (let i = 0; i < 32; i += 1) {
                gql_device_id += chars.charAt(Math.floor(Math.random() * chars.length));
            }
        }
        var headers = {
            'Client-Id': CLIENT_ID,
            'Client-Integrity': ClientIntegrityHeader,
            'X-Device-Id': gql_device_id,
            'Authorization': AuthorizationHeader
        };
        return new Promise((resolve, reject) => {
            const requestId = Math.random().toString(36).substring(2, 15);
            const fetchRequest = {
                id: requestId,
                url: 'https://gql.twitch.tv/gql',
                options: {
                    method: 'POST',
                    body: JSON.stringify(body),
                    headers
                }
            };
            pendingFetchRequests.set(requestId, {
                resolve,
                reject
            });
            postMessage({
                key: 'FetchRequest',
                value: fetchRequest
            });
        });
    }
    function parseAttributes(str) {
        return Object.fromEntries(
            str.split(/(?:^|,)((?:[^=]*)=(?:"[^"]*"|[^,]*))/)
                .filter(Boolean)
                .map(x => {
                    const idx = x.indexOf('=');
                    const key = x.substring(0, idx);
                    const value = x.substring(idx +1);
                    const num = Number(value);
                    return [key, Number.isNaN(num) ? value.startsWith('"') ? JSON.parse(value) : value : num]
                }));
    }
    async function tryNotifyAdsWatchedM3U8(streamM3u8) {
        try {
            //console.log(streamM3u8);
            if (!streamM3u8 || !streamM3u8.includes(AD_SIGNIFIER)) {
                return 1;
            }
            var matches = streamM3u8.match(/#EXT-X-DATERANGE:(ID="stitched-ad-[^\n]+)\n/);
            if (matches.length > 1) {
                const attrString = matches[1];
                const attr = parseAttributes(attrString);
                var podLength = parseInt(attr['X-TV-TWITCH-AD-POD-LENGTH'] ? attr['X-TV-TWITCH-AD-POD-LENGTH'] : '1');
                var podPosition = parseInt(attr['X-TV-TWITCH-AD-POD-POSITION'] ? attr['X-TV-TWITCH-AD-POD-POSITION'] : '0');
                var radToken = attr['X-TV-TWITCH-AD-RADS-TOKEN'];
                var lineItemId = attr['X-TV-TWITCH-AD-LINE-ITEM-ID'];
                var orderId = attr['X-TV-TWITCH-AD-ORDER-ID'];
                var creativeId = attr['X-TV-TWITCH-AD-CREATIVE-ID'];
                var adId = attr['X-TV-TWITCH-AD-ADVERTISER-ID'];
                var rollType = attr['X-TV-TWITCH-AD-ROLL-TYPE'].toLowerCase();
                const baseData = {
                    stitched: true,
                    roll_type: rollType,
                    player_mute: false,
                    player_volume: 0.5,
                    visible: true,
                };
                for (let podPosition = 0; podPosition < podLength; podPosition++) {
                    if (OPT_MODE_NOTIFY_ADS_WATCHED_MIN_REQUESTS) {
                        // This is all that's actually required at the moment
                        await gqlRequest(makeGraphQlPacket('video_ad_pod_complete', radToken, baseData));
                    } else {
                        const extendedData = {
                            ...baseData,
                            ad_id: adId,
                            ad_position: podPosition,
                            duration: 30,
                            creative_id: creativeId,
                            total_ads: podLength,
                            order_id: orderId,
                            line_item_id: lineItemId,
                        };
                        await gqlRequest(makeGraphQlPacket('video_ad_impression', radToken, extendedData));
                        for (let quartile = 0; quartile < 4; quartile++) {
                            await gqlRequest(
                                makeGraphQlPacket('video_ad_quartile_complete', radToken, {
                                    ...extendedData,
                                    quartile: quartile + 1,
                                })
                            );
                        }
                        await gqlRequest(makeGraphQlPacket('video_ad_pod_complete', radToken, baseData));
                    }
                }
            }
            return 0;
        } catch (err) {
            console.log(err);
            return 0;
        }
    }
    function postTwitchWorkerMessage(key, value) {
        twitchWorkers.forEach((worker) => {
            worker.postMessage({key: key, value: value});
        });
    }
    function makeGmXmlHttpRequest(fetchRequest) {
        return new Promise((resolve, reject) => {
            GM.xmlHttpRequest({
                method: fetchRequest.options.method,
                url: fetchRequest.url,
                data: fetchRequest.options.body,
                headers: fetchRequest.options.headers,
                onload: response => resolve(response),
                onerror: error => reject(error)
            });
        });
    }
    // Taken from https://github.com/dimdenGD/YeahTwitter/blob/9e0520f5abe029f57929795d8de0d2e5d3751cf3/us.js#L48
    function parseHeaders(headersString) {
        const headers = new Headers();
        const lines = headersString.trim().split(/[\r\n]+/);
        lines.forEach(line => {
            const parts = line.split(':');
            const header = parts.shift();
            const value = parts.join(':');
            headers.append(header, value);
        });
        return headers;
    }
    var serverLikesThisBrowser = false;
    var serverHatesThisBrowser = false;
    async function handleWorkerFetchRequest(fetchRequest) {
        try {
            if (serverLikesThisBrowser || !serverHatesThisBrowser) {
                const response = await unsafeWindow.realFetch(fetchRequest.url, fetchRequest.options);
                const responseBody = await response.text();
                const responseObject = {
                    id: fetchRequest.id,
                    status: response.status,
                    statusText: response.statusText,
                    headers: Object.fromEntries(response.headers.entries()),
                    body: responseBody
                };
                if (responseObject.status === 200) {
                    var resp = JSON.parse(responseBody);
                    if (typeof resp.errors !== 'undefined') {
                        serverHatesThisBrowser = true;
                    } else {
                        serverLikesThisBrowser = true;
                    }
                }
                if (serverLikesThisBrowser || !serverHatesThisBrowser) {
                    return responseObject;
                }
            }
            if (typeof GM !== 'undefined' && typeof GM.xmlHttpRequest !== 'undefined') {
                fetchRequest.options.headers['Sec-Ch-Ua'] = '"Google Chrome";v="137", "Chromium";v="137", "Not/A)Brand";v="24"';
                fetchRequest.options.headers['Referer'] = 'https://www.twitch.tv/';
                fetchRequest.options.headers['Origin'] = 'https://www.twitch.tv/';
                fetchRequest.options.headers['Host'] = 'gql.twitch.tv';
                const response = await makeGmXmlHttpRequest(fetchRequest);
                const responseBody = response.responseText;
                const responseObject = {
                    id: fetchRequest.id,
                    status: response.status,
                    statusText: response.statusText,
                    headers: Object.fromEntries(parseHeaders(response.responseHeaders).entries()),
                    body: responseBody
                };
                return responseObject;
            }
            throw { message: 'Failed to resolve GQL request. Try the userscript version of the ad blocking solution' };
        } catch (error) {
            return {
                id: fetchRequest.id,
                error: error.message
            };
        }
    }
    function hookFetch() {
        var realFetch = unsafeWindow.fetch;
        unsafeWindow.realFetch = realFetch;
        unsafeWindow.fetch = function(url, init, ...args) {
            if (typeof url === 'string') {
                if (url.includes('gql')) {
                    var deviceId = init.headers['X-Device-Id'];
                    if (typeof deviceId !== 'string') {
                        deviceId = init.headers['Device-ID'];
                    }
                    if (typeof deviceId === 'string') {
                        gql_device_id = deviceId;
                    }
                    if (gql_device_id) {
                        postTwitchWorkerMessage('UboUpdateDeviceId', gql_device_id);
                    }
                    if (typeof init.body === 'string' && init.body.includes('PlaybackAccessToken')) {
                        if (OPT_ACCESS_TOKEN_PLAYER_TYPE) {
                            const newBody = JSON.parse(init.body);
                            if (Array.isArray(newBody)) {
                                for (let i = 0; i < newBody.length; i++) {
                                    newBody[i].variables.playerType = OPT_ACCESS_TOKEN_PLAYER_TYPE;
                                }
                            } else {
                                newBody.variables.playerType = OPT_ACCESS_TOKEN_PLAYER_TYPE;
                            }
                            init.body = JSON.stringify(newBody);
                        }
                        if (typeof init.headers['Client-Integrity'] === 'string') {
                            ClientIntegrityHeader = init.headers['Client-Integrity'];
                            if (ClientIntegrityHeader) {
                                postTwitchWorkerMessage('UpdateClientIntegrityHeader', init.headers['Client-Integrity']);
                            }
                        }
                        if (typeof init.headers['Authorization'] === 'string') {
                            AuthorizationHeader = init.headers['Authorization'];
                            if (AuthorizationHeader) {
                                postTwitchWorkerMessage('UpdateAuthorizationHeader', init.headers['Authorization']);
                            }
                        }
                    }
                }
            }
            return realFetch.apply(this, arguments);
        };
    }
    function reloadTwitchPlayer(isSeek, isPausePlay) {
        // Taken from ttv-tools / ffz
        // https://github.com/Nerixyz/ttv-tools/blob/master/src/context/twitch-player.ts
        // https://github.com/FrankerFaceZ/FrankerFaceZ/blob/master/src/sites/twitch-twilight/modules/player.jsx
        function findReactNode(root, constraint) {
            if (root.stateNode && constraint(root.stateNode)) {
                return root.stateNode;
            }
            let node = root.child;
            while (node) {
                const result = findReactNode(node, constraint);
                if (result) {
                    return result;
                }
                node = node.sibling;
            }
            return null;
        }
        function findReactRootNode() {
            var reactRootNode = null;
            var rootNode = document.querySelector('#root');
            if (rootNode && rootNode._reactRootContainer && rootNode._reactRootContainer._internalRoot && rootNode._reactRootContainer._internalRoot.current) {
                reactRootNode = rootNode._reactRootContainer._internalRoot.current;
            }
            if (reactRootNode == null) {
                var containerName = Object.keys(rootNode).find(x => x.startsWith('__reactContainer'));
                if (containerName != null) {
                    reactRootNode = rootNode[containerName];
                }
            }
            return reactRootNode;
        }
        var reactRootNode = findReactRootNode();
        if (!reactRootNode) {
            console.log('Could not find react root');
            return;
        }
        var player = findReactNode(reactRootNode, node => node.setPlayerActive && node.props && node.props.mediaPlayerInstance);
        player = player && player.props && player.props.mediaPlayerInstance ? player.props.mediaPlayerInstance : null;
        var playerState = findReactNode(reactRootNode, node => node.setSrc && node.setInitialPlaybackSettings);
        if (!player) {
            console.log('Could not find player');
            return;
        }
        if (!playerState) {
            console.log('Could not find player state');
            return;
        }
        if (player.paused || player.core?.paused) {
            return;
        }
        if (isSeek) {
            console.log('Force seek to reset player (hopefully fixing any audio desync) pos:' + player.getPosition() + ' range:' + JSON.stringify(player.getBuffered()));
            var pos = player.getPosition();
            player.seekTo(0);
            player.seekTo(pos);
            return;
        }
        if (isPausePlay) {
            player.pause();
            player.play();
            return;
        }
        const lsKeyQuality = 'video-quality';
        const lsKeyMuted = 'video-muted';
        const lsKeyVolume = 'volume';
        var currentQualityLS = localStorage.getItem(lsKeyQuality);
        var currentMutedLS = localStorage.getItem(lsKeyMuted);
        var currentVolumeLS = localStorage.getItem(lsKeyVolume);
        if (player?.core?.state) {
            localStorage.setItem(lsKeyMuted, JSON.stringify({default:player.core.state.muted}));
            localStorage.setItem(lsKeyVolume, player.core.state.volume);
        }
        if (player?.core?.state?.quality?.group) {
            localStorage.setItem(lsKeyQuality, JSON.stringify({default:player.core.state.quality.group}));
        }
        playerState.setSrc({ isNewMediaPlayerInstance: true, refreshAccessToken: true });
        setTimeout(() => {
            localStorage.setItem(lsKeyQuality, currentQualityLS);
            localStorage.setItem(lsKeyMuted, currentMutedLS);
            localStorage.setItem(lsKeyVolume, currentVolumeLS);
        }, 3000);
    }
    function onContentLoaded() {
        // This stops Twitch from pausing the player when in another tab and an ad shows.
        // Taken from https://github.com/saucettv/VideoAdBlockForTwitch/blob/cefce9d2b565769c77e3666ac8234c3acfe20d83/chrome/content.js#L30
        try {
            Object.defineProperty(document, 'visibilityState', {
                get() {
                    return 'visible';
                }
            });
        }catch{}
        let hidden = document.__lookupGetter__('hidden');
        let webkitHidden = document.__lookupGetter__('webkitHidden');
        try {
            Object.defineProperty(document, 'hidden', {
                get() {
                    return false;
                }
            });
        }catch{}
        var block = e => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
        };
        let wasVideoPlaying = true;
        var visibilityChange = e => {
            if (typeof chrome !== 'undefined') {
                const videos = document.getElementsByTagName('video');
                if (videos.length > 0) {
                    if (hidden.apply(document) === true || (webkitHidden && webkitHidden.apply(document) === true)) {
                        wasVideoPlaying = !videos[0].paused && !videos[0].ended;
                    } else if (wasVideoPlaying && !videos[0].ended) {
                        videos[0].play();
                    }
                }
            }
            block(e);
        };
        document.addEventListener('visibilitychange', visibilityChange, true);
        document.addEventListener('webkitvisibilitychange', visibilityChange, true);
        document.addEventListener('mozvisibilitychange', visibilityChange, true);
        document.addEventListener('hasFocus', block, true);
        try {
            if (/Firefox/.test(navigator.userAgent)) {
                Object.defineProperty(document, 'mozHidden', {
                    get() {
                        return false;
                    }
                });
            } else {
                Object.defineProperty(document, 'webkitHidden', {
                    get() {
                        return false;
                    }
                });
            }
        }catch{}
        // Hooks for preserving volume / resolution
        var keysToCache = [
            'video-quality',
            'video-muted',
            'volume',
            'lowLatencyModeEnabled',// Low Latency
            'persistenceEnabled',// Mini Player
        ];
        var cachedValues = new Map();
        for (var i = 0; i < keysToCache.length; i++) {
            cachedValues.set(keysToCache[i], localStorage.getItem(keysToCache[i]));
        }
        var realSetItem = localStorage.setItem;
        localStorage.setItem = function(key, value) {
            if (cachedValues.has(key)) {
                cachedValues.set(key, value);
            }
            realSetItem.apply(this, arguments);
        };
        var realGetItem = localStorage.getItem;
        localStorage.getItem = function(key) {
            if (cachedValues.has(key)) {
                return cachedValues.get(key);
            }
            return realGetItem.apply(this, arguments);
        };
    }
    unsafeWindow.reloadTwitchPlayer = reloadTwitchPlayer;
    declareOptions(unsafeWindow);
    hookWindowWorker();
    hookFetch();
    if (document.readyState === "complete" || document.readyState === "loaded" || document.readyState === "interactive") {
        onContentLoaded();
    } else {
        unsafeWindow.addEventListener("DOMContentLoaded", function() {
            onContentLoaded();
        });
    }
})();
