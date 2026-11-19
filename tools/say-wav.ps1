# One synthetic spoken turn for the adventure's voice-only check (tools/adventure-play.mjs ADV_VOICE_DIR):
# Windows speech says $env:ADV_SAY_TEXT in an English voice into a 16 kHz mono WAV, with 0.7 s of quiet before and
# 3.5 s after (Chrome's fake microphone loops the file; the quiet after lets the turn end by itself).
# A blank text makes a quiet file (the "say it again" turn).
param([Parameter(Mandatory = $true)][string]$Out)
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$v = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'en-*' } | Select-Object -First 1
if ($v) { $s.SelectVoice($v.VoiceInfo.Name) }
$s.Rate = -1
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile($Out, $fmt)
$text = [string]$env:ADV_SAY_TEXT
$esc = [System.Security.SecurityElement]::Escape($text.Trim())
if ($esc) {
  $body = "<break time='700ms'/>$esc<break time='3500ms'/>"
} else {
  $body = "<break time='5000ms'/>"
}
$s.SpeakSsml("<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>$body</speak>")
$s.Dispose()
