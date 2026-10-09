#!/bin/bash
# NexusLink — generate real sample media files for working previews
set -e
BASE="/home/z/my-project/data/nexus-storage"
mkdir -p "$BASE/media/DCIM/Camera" "$BASE/media/Music" "$BASE/media/Documents" "$BASE/media/Download" "$BASE/media/Movies" "$BASE/media/WhatsApp/Media"
P="$BASE/media/DCIM/Camera"

echo "=== 1. Photos (JPG) ==="
ffmpeg -y -loglevel error -f lavfi -i "gradients=size=1600x1200:c0=#0f2027:c1=#2c5364:duration=1" -frames:v 1 -q:v 3 "$P/IMG_20260101_0930.jpg" &
ffmpeg -y -loglevel error -f lavfi -i "gradients=size=1600x1200:c0=#ff9966:c1=#ff5e62:duration=1" -frames:v 1 -q:v 3 "$P/IMG_20260102_1415.jpg" &
ffmpeg -y -loglevel error -f lavfi -i "gradients=size=1200x1600:c0=#43cea2:c1=#185a9d:duration=1" -frames:v 1 -q:v 3 "$P/IMG_20260103_1832.jpg" &
ffmpeg -y -loglevel error -f lavfi -i "gradients=size=1600x1200:c0=#f7971e:c1=#ffd200:duration=1" -frames:v 1 -q:v 3 "$P/IMG_20260105_0712.jpg" &
ffmpeg -y -loglevel error -f lavfi -i "gradients=size=1600x900:c0=#8e2de2:c1=#4a00e0:duration=1" -frames:v 1 -q:v 3 "$P/IMG_20260106_2201.jpg" &
ffmpeg -y -loglevel error -f lavfi -i "gradients=size=1200x1600:c0=#ee9ca7:c1=#ffdde1:duration=1" -frames:v 1 -q:v 3 "$P/IMG_20260108_1210.jpg" &
wait
ffmpeg -y -loglevel error -f lavfi -i "color=c=0x1a1a2e:s=1080x2400:d=1" -frames:v 1 "$BASE/media/Download/Screenshot_2026-01-07-10-24.png"

echo "=== 2. Videos (MP4 with audio) ==="
ffmpeg -y -loglevel error -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=12" \
  -f lavfi -i "sine=frequency=440:duration=12" \
  -c:v libx264 -pix_fmt yuv420p -preset veryfast -crf 28 -c:a aac -b:a 96k -shortest "$BASE/media/DCIM/Camera/VID_20260102_1415.mp4" &
ffmpeg -y -loglevel error -f lavfi -i "smptebars=size=1280x720:rate=30:duration=9" \
  -f lavfi -i "sine=frequency=660:duration=9" \
  -c:v libx264 -pix_fmt yuv420p -preset veryfast -crf 28 -c:a aac -b:a 96k -shortest "$BASE/media/Movies/movie_trailer.mp4" &
wait

echo "=== 3. Music (MP3) ==="
ffmpeg -y -loglevel error -f lavfi -i "sine=frequency=523:duration=45" -f lavfi -i "sine=frequency=659:duration=45" \
  -filter_complex "[0:a][1:a]amix=inputs=2,volume=0.6" -codec:a libmp3lame -b:a 128k "$BASE/media/Music/ambient_tone_c.mp3" &
ffmpeg -y -loglevel error -f lavfi -i "sine=frequency=392:duration=38" -f lavfi -i "sine=frequency=494:duration=38" \
  -filter_complex "[0:a][1:a]amix=inputs=2,volume=0.6" -codec:a libmp3lame -b:a 128k "$BASE/media/Music/recording_note_g.mp3" &
wait

echo "=== 4. Fake APK + ZIP (real zip containers) ==="
mkdir -p /tmp/apkbuild && echo "NexusLink demo APK payload v2.4.1" > /tmp/apkbuild/manifest.txt
cd /tmp/apkbuild && zip -q -r "$BASE/media/Download/nexus-app-2.4.1.apk" . && cd "$BASE"
zip -q -r "$BASE/media/Download/project_backup.zip" media/Documents

echo "=== Done ==="
du -sh "$BASE/media"/* 
