#!/usr/bin/env bash
# Generates the test media used by test.mjs (needs ffmpeg + openssl).
set -euo pipefail
cd "$(dirname "$0")" && mkdir -p media && cd media
SRC="-f lavfi -i testsrc2=size=1280x720:rate=25 -f lavfi -i sine=frequency=440:sample_rate=44100"
ffmpeg -loglevel error -y $SRC -t 12 -c:v libx264 -b:v 1500k -pix_fmt yuv420p -c:a aac -b:a 96k -movflags +faststart big.mp4
ffmpeg -loglevel error -y $SRC -t 6 -vf scale=640:360 -c:v libvpx-vp9 -b:v 800k -c:a libopus clip.webm
ffmpeg -loglevel error -y -f lavfi -i testsrc2=size=160x90:rate=10 -t 1 -c:v libx264 -pix_fmt yuv420p tiny.mp4
ffmpeg -loglevel error -y -i big.mp4 -frames:v 1 -vf scale=320:-1 poster.jpg
mkdir -p hls
ffmpeg -loglevel error -y -i big.mp4 -c:v libx264 -b:v 1500k -c:a aac -g 50 -keyint_min 50 -sc_threshold 0 -hls_time 2 -hls_playlist_type vod -hls_segment_filename "hls/720_%03d.ts" hls/720.m3u8
ffmpeg -loglevel error -y -i big.mp4 -vf scale=640:360 -c:v libx264 -b:v 500k -c:a aac -g 50 -keyint_min 50 -sc_threshold 0 -hls_time 2 -hls_playlist_type vod -hls_segment_filename "hls/360_%03d.ts" hls/360.m3u8
printf '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=1700000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"\n720.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=600000,RESOLUTION=640x360,CODECS="avc1.64001e,mp4a.40.2"\n360.m3u8\n' > hls/master.m3u8
mkdir -p enc && openssl rand 16 > enc/key.bin
(cd enc && printf 'key.bin\nkey.bin\n%s\n' "$(openssl rand -hex 16)" > keyinfo && ffmpeg -loglevel error -y -i ../big.mp4 -c copy -hls_time 2 -hls_playlist_type vod -hls_key_info_file keyinfo -hls_segment_filename "e_%03d.ts" index.m3u8)
mkdir -p fmp4 && ffmpeg -loglevel error -y -i big.mp4 -c copy -hls_time 2 -hls_playlist_type vod -hls_segment_type fmp4 -hls_fmp4_init_filename init.mp4 -hls_segment_filename "fmp4/seg_%03d.m4s" fmp4/index.m3u8
mkdir -p dash && ffmpeg -loglevel error -y -i big.mp4 -map 0:v -map 0:v -map 0:a -c:v:0 libx264 -b:v:0 1500k -c:v:1 libx264 -b:v:1 400k -s:v:1 640x360 -c:a aac -g 50 -keyint_min 50 -sc_threshold 0 -seg_duration 2 -use_template 1 -use_timeline 1 -adaptation_sets "id=0,streams=v id=1,streams=a" -f dash dash/manifest.mpd
mkdir -p protected && cp hls/360.m3u8 hls/360_*.ts protected/
sed -E 's#^(360_[0-9]+\.ts)$#http://127.0.0.1:8765/media/protected/\1#' protected/360.m3u8 > xhost.m3u8
# 60 s source for the simulated live stream (continuous timestamps)
mkdir -p live && ffmpeg -loglevel error -y $SRC -t 60 -c:v libx264 -b:v 800k -pix_fmt yuv420p -c:a aac -g 50 -keyint_min 50 -sc_threshold 0 -f hls -hls_time 2 -hls_list_size 0 -hls_segment_filename "live/l_%03d.ts" live/all.m3u8
echo "Fixtures ready in $(pwd)"
