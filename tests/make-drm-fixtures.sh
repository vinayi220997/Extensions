#!/bin/sh
# DRM + format fixtures for test6.mjs. Needs ffmpeg and python3. The encrypted file is real
# Common Encryption (cenc, AES-CTR) made by ffmpeg; the test page plays it with the browser's
# built-in ClearKey CDM through a local licence server — the same EME flow DRM sites use.
set -e
cd "$(dirname "$0")/media"
KEY=76a6c65c5ea762046bd749a2e632ccbb
KID=a7e61c373e219033c21091fa607bf3b8
ffmpeg -v error -y -i big.mp4 -t 6 -an -c:v copy -movflags frag_keyframe+empty_moov+default_base_moof \
  -encryption_scheme cenc-aes-ctr -encryption_key $KEY -encryption_kid $KID drm/enc.mp4
python3 - <<'PY'
import base64, struct
def pssh(sysid, data=b'', kids=()):
    v = 1 if kids else 0
    body = bytes([v, 0, 0, 0]) + bytes.fromhex(sysid)
    if kids: body += struct.pack('>I', len(kids)) + b''.join(bytes.fromhex(k) for k in kids)
    body += struct.pack('>I', len(data)) + data
    return struct.pack('>I', 8 + len(body)) + b'pssh' + body
KID = 'a7e61c373e219033c21091fa607bf3b8'
wv = base64.b64encode(pssh('edef8ba979d64acea3c827dcd51d21ed', b'\x12\x10' + bytes.fromhex(KID), [KID])).decode()
pr = base64.b64encode(pssh('9a04f07998404286ab92e65be0885f95', b'<WRMHEADER/>')).decode()
kid_uuid = f'{KID[:8]}-{KID[8:12]}-{KID[12:16]}-{KID[16:20]}-{KID[20:]}'
open('drm/stream.mpd', 'w').write(f'''<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" xmlns:cenc="urn:mpeg:cenc:2013" xmlns:mspr="urn:microsoft:playready" xmlns:dashif="https://dashif.org/CPS"
  type="static" mediaPresentationDuration="PT6S" minBufferTime="PT2S" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011">
 <Period>
  <AdaptationSet mimeType="video/mp4" contentType="video">
   <ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" value="cenc" cenc:default_KID="{kid_uuid}"/>
   <ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"><cenc:pssh>{wv}</cenc:pssh>
    <dashif:Laurl>https://license.example.test/widevine?token=secret</dashif:Laurl></ContentProtection>
   <ContentProtection schemeIdUri="urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95"><cenc:pssh>{pr}</cenc:pssh><mspr:pro>AAAA</mspr:pro></ContentProtection>
   <Representation id="v720" bandwidth="2000000" width="1280" height="720" codecs="avc1.64001f"><BaseURL>enc.mp4</BaseURL><SegmentBase indexRange="0-0"/></Representation>
   <Representation id="v360" bandwidth="700000" width="640" height="360" codecs="avc1.64001e"><BaseURL>enc.mp4</BaseURL><SegmentBase indexRange="0-0"/></Representation>
  </AdaptationSet>
 </Period>
</MPD>
''')
open('drm/fairplay.m3u8', 'w').write('''#EXTM3U
#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES,URI="skd://fps.example.test/key42",KEYFORMAT="com.apple.streamingkeydelivery",KEYFORMATVERSIONS="1"
#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"
fp_1080.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"
fp_720.m3u8
''')
for n in ('fp_1080', 'fp_720'):
    open(f'drm/{n}.m3u8', 'w').write('''#EXTM3U
#EXT-X-VERSION:5
#EXT-X-TARGETDURATION:6
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://fps.example.test/key42",KEYFORMAT="com.apple.streamingkeydelivery",KEYFORMATVERSIONS="1"
#EXTINF:6.0,
../hls/360_000.ts
#EXT-X-ENDLIST
''')
open('drm/widevine-hls.m3u8', 'w').write(f'''#EXTM3U
#EXT-X-VERSION:6
#EXT-X-TARGETDURATION:6
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-KEY:METHOD=SAMPLE-AES-CTR,URI="data:text/plain;base64,{wv}",KEYFORMAT="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed",KEYFORMATVERSIONS="1"
#EXT-X-MAP:URI="enc.mp4"
#EXTINF:6.0,
enc.mp4
#EXT-X-ENDLIST
''')
PY
# Real-world packaging with Shaka Packager (Google, BSD): CENC DASH (Widevine + PlayReady PSSH) and
# cbcs HLS (FairPlay + Widevine keys), encrypted from the first frame. Binary from
# https://github.com/shaka-project/shaka-packager/releases (v3.4.2 packager-linux-x64).
PACKAGER=${PACKAGER:-packager}
ffmpeg -v error -y -i big.mp4 -t 6 -c copy drm/src6.mp4
RAW="--enable_raw_key_encryption --keys label=:key_id=$KID:key=$KEY --clear_lead 0"
rm -rf drm/sp drm/sphls && mkdir -p drm/sp drm/sphls
(cd drm/sp && $PACKAGER "in=../src6.mp4,stream=video,output=video.mp4" $RAW --protection_systems Widevine,PlayReady --protection_scheme cenc --mpd_output stream.mpd)
(cd drm/sphls && $PACKAGER "in=../src6.mp4,stream=video,segment_template=v_\$Number\$.m4s,init_segment=v_init.mp4,playlist_name=video.m3u8" $RAW \
  --protection_systems FairPlay,Widevine --protection_scheme cbcs --hls_key_uri "skd://fps.example.test/a7e61c37" --hls_master_playlist_output master.m3u8)
# Container formats (short clips) for detection tests.
ffmpeg -v error -y -i big.mp4 -t 3 -c:v mpeg2video -q:v 6 -an fmt/sample.mpg
ffmpeg -v error -y -i big.mp4 -t 3 -c copy fmt/sample.mov
ffmpeg -v error -y -i big.mp4 -t 3 -c:v mpeg4 -q:v 6 -an fmt/sample.avi
ffmpeg -v error -y -i big.mp4 -t 3 -c copy fmt/sample.mkv
ffmpeg -v error -y -i big.mp4 -t 3 -s 352x288 -c:v h263 -an fmt/sample.3gp
ffmpeg -v error -y -i big.mp4 -t 3 -c:v flv1 -an fmt/sample.flv
ffmpeg -v error -y -i big.mp4 -t 3 -c:v libtheora -q:v 5 -an fmt/sample.ogv 2>/dev/null || ffmpeg -v error -y -i clip.webm -t 3 -c:v libvpx -an -f ogg fmt/sample.ogv || true
# A whole transport-stream recording (> 25 MB, not an HLS segment).
ffmpeg -v error -y -stream_loop 12 -i big.mp4 -c copy -f mpegts fmt/recording.ts
ls -la drm fmt
