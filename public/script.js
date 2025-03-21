// Check for browser support
if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
  document.getElementById('recordButton').addEventListener('click', startRecording);
} else {
  document.getElementById('status').innerText = "Your browser does not support audio recording.";
}

function startRecording() {
  // Prefer audio/wav if supported; otherwise, use audio/webm.
  let mimeType = "audio/wav";
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    mimeType = "audio/webm";
  }
  
  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(stream => {
      document.getElementById('status').innerText = "Recording... Please cough now!";
      const mediaRecorder = new MediaRecorder(stream, { mimeType: mimeType });
      let chunks = [];
      
      mediaRecorder.ondataavailable = e => {
        chunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
        sendAudio(blob);
      };

      mediaRecorder.start();
      setTimeout(() => {
        mediaRecorder.stop();
        document.getElementById('status').innerText = "Processing...";
      }, 2000); // Record for 2 seconds
    })
    .catch(err => {
      document.getElementById('status').innerText = "Error accessing microphone: " + err;
    });
}

function sendAudio(audioBlob) {
  const reader = new FileReader();
  reader.readAsDataURL(audioBlob);
  reader.onloadend = () => {
    const dataUrl = reader.result;
    const parts = dataUrl.split(',');
    const base64data = parts[1];
    const mimeMatch = dataUrl.match(/^data:(.*?);/);
    const mimeType = mimeMatch ? mimeMatch[1] : "audio/wav";
    
    fetch("/.netlify/functions/processAudio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioBase64: base64data, mimeType: mimeType })
    })
    .then(response => response.json())
    .then(data => {
      if (data.error) {
        document.getElementById('status').innerText = "Error processing audio: " + data.error;
      } else if (data.result && Array.isArray(data.result) && data.result.length > 0 && data.result[0].embedding) {
        const embedding = data.result[0].embedding;
        const summary = "Embedding length: " + embedding.length + 
                        ". First five values: " + embedding.slice(0, 5).join(', ');
        document.getElementById('status').innerText = "Result: " + summary;
      } else {
        document.getElementById('status').innerText = "Result: " + JSON.stringify(data.result);
      }
    })
    .catch(error => {
      document.getElementById('status').innerText = "Error processing audio: " + error;
    });
  }
}
