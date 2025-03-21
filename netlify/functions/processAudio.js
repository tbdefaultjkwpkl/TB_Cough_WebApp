const fetch = require('node-fetch'); // Ensure node-fetch@2 is installed.
const wav = require('node-wav');
const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

// Import googleapis for Sheets integration.
const { google } = require('googleapis');

// Replace with your Google Sheet ID (the long string in your sheet's URL).
const SPREADSHEET_ID = '1lPCBXw0CVThP3RA6hlyYVaseIqxzZYJRPmRDO744jVM';

// Configure Google Sheets API client.
const sheets = google.sheets('v4');
const auth = new google.auth.GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

async function appendToSheet(row) {
  const client = await auth.getClient();
  await sheets.spreadsheets.values.append({
    auth: client,
    spreadsheetId: SPREADSHEET_ID,
    range: 'Sheet1!A:C', // Assuming your sheet has columns A, B, C for Timestamp, Embedding, Label.
    valueInputOption: 'RAW',
    requestBody: {
      values: [row]
    }
  });
}

exports.handler = async function(event, context) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    // Parse the incoming JSON payload.
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

    // Decode the WAV file.
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

    // Obtain Bearer token using gcloud.
    let bearerToken;
    try {
      bearerToken = execSync("gcloud auth application-default print-access-token").toString().trim();
    } catch (error) {
      throw new Error("Failed to get Bearer token. Ensure Google Cloud SDK is installed and you are authenticated.");
    }

    // Prepare payload for the HeAR model using "input_array".
    const payload = {
      instances: [{ input_array: Array.from(processedSamples) }]
    };

    // Use your active Vertex AI endpoint.
    const hearApiUrl = "https://us-central1-aiplatform.googleapis.com/v1/projects/tb-cough-webapp/locations/us-central1/endpoints/7767518586121224192:predict";

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
    let embeddingResult = hearData.predictions;

    // OPTIONAL: For storage, you might save a summary or the full embedding.
    // Here we store a JSON string of the embedding.
    const embeddingString = JSON.stringify(embeddingResult);
    const timestamp = new Date().toISOString();
    const label = ""; // Leave blank for now; user can add classification later.

    // Append a row to the Google Sheet: [Timestamp, Embedding, Label].
    await appendToSheet([timestamp, embeddingString, label]);

    // Return the embedding result.
    return {
      statusCode: 200,
      body: JSON.stringify({ result: embeddingResult })
    };

  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
