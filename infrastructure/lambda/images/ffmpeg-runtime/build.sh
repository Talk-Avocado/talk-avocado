#!/usr/bin/env bash
set -euo pipefail

IMG_NAME="${IMG_NAME:-ffmpeg-runtime}"
ECR_URI="${ECR_URI:?Set ECR_URI, e.g., 123456789012.dkr.ecr.us-east-1.amazonaws.com}"
FFMPEG_URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
FFMPEG_SHA256="${FFMPEG_SHA256:-}" # optional pin

tmpdir="$(mktemp -d)"
pushd "$tmpdir" >/dev/null

echo "Downloading pinned ffmpeg..."
curl -sSL -o ffmpeg.tar.xz "$FFMPEG_URL"
if [ -n "${FFMPEG_SHA256}" ]; then
  echo "${FFMPEG_SHA256}  ffmpeg.tar.xz" | sha256sum -c -
fi
tar -xf ffmpeg.tar.xz --strip-components=1

mkdir -p ./bin
cp ffmpeg ffprobe ./bin/
chmod +x ./bin/ffmpeg ./bin/ffprobe

# Build using the bin/ as a stage context
cp -r ./bin "$(git rev-parse --show-toplevel)/infrastructure/lambda/images/ffmpeg-runtime/"
popd >/dev/null
rm -rf "$tmpdir"

echo "Building image..."
docker build -t "$IMG_NAME:latest" infrastructure/lambda/images/ffmpeg-runtime

echo "Login to ECR and push..."
aws ecr get-login-password | docker login --username AWS --password-stdin "$ECR_URI"
docker tag "$IMG_NAME:latest" "$ECR_URI/$IMG_NAME:latest"
docker push "$ECR_URI/$IMG_NAME:latest"
