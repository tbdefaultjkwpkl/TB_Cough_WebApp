const fetch = require('node-fetch'); // Make sure node-fetch@2 is installed.
const wav = require('node-wav');
const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

exports.handler = async function(event, context) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    // Parse the JSON payload.
    const body = JSON.parse(event.body);
    if (!body.audioBase64) {
      throw new Error("No audio data provided.");
    }

    const mimeType = body.mimeType || "audio/wav";
    let audioBuffer = Buffer.from(body.audioBase64, 'base64');

    // If the audio is in webm format, convert it to WAV using ffmpeg.
    if (mimeType === "audio/webm") {
      const os = require('os');
      const tmpDir = os.tmpdir();
      const inputFile = path.join(tmpDir, `input_${Date.now()}.webm`);
      const outputFile = path.join(tmpDir, `output_${Date.now()}.wav`);

      fs.writeFileSync(inputFile, audioBuffer);
      try {
        execFileSync(ffmpegPath, ['-i', inputFile, outputFile]);
      } catch (err) {
        throw new Error("FFmpeg conversion failed: " + err.message);
      }
      audioBuffer = fs.readFileSync(outputFile);
      fs.unlinkSync(inputFile);
      fs.unlinkSync(outputFile);
    }

    // Decode WAV file.
    let decoded;
    try {
      decoded = wav.decode(audioBuffer);
    } catch (e) {
      throw new Error("Invalid WAV file: " + e.message);
    }
    let samples = decoded.channelData[0];

    // Ensure exactly 32000 samples (2 seconds at 16kHz).
    const requiredSamples = 32000;
    let processedSamples;
    if (samples.length > requiredSamples) {
      processedSamples = samples.slice(0, requiredSamples);
    } else if (samples.length < requiredSamples) {
      processedSamples = new Float32Array(requiredSamples);
      processedSamples.set(samples);
    } else {
      processedSamples = samples;
    }

    // Prepare payload for the HeAR model.
    // We use "input_array" to send an array of 32000 floats.
    const payload = {
      instances: [{ input_array: Array.from(processedSamples) }]
    };

    // Use your deployed HeAR endpoint from Vertex AI.
    const hearApiUrl = "https://us-central1-aiplatform.googleapis.com/v1/projects/tb-cough-webapp/locations/us-central1/endpoints/7767518586121224192:predict";

    // Obtain a Bearer token using gcloud.
    let bearerToken;
    try {
      bearerToken = execSync("gcloud auth application-default print-access-token").toString().trim();
    } catch (error) {
      throw new Error("Failed to get Bearer token. Ensure Google Cloud SDK is installed and you are authenticated.");
    }

    // Call the HeAR model.
    const hearResponse = await fetch(hearApiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${bearerToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!hearResponse.ok) {
      const errText = await hearResponse.text();
      throw new Error("HeAR API error: " + errText);
    }

    const hearData = await hearResponse.json();

    // Return the embedding.
    let classification = hearData.predictions;
    return {
      statusCode: 200,
      body: JSON.stringify({ result: classification })
    };

  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
