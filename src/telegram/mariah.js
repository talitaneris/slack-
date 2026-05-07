async function shouldRespondWithVoice(userText, responseText, sourceIsVoice) {
  if (sourceIsVoice) return true;

  const lowerUser = userText.toLowerCase();

  const voiceRequests = [
    'responde em audio', 'manda audio', 'quero ouvir',
    'fala pra mim', 'me manda audio', 'resposta em audio',
    'audio por favor', 'em voz', 'me fala'
  ];

  const hasVoiceRequest = voiceRequests.some(t => lowerUser.includes(t));
  if (hasVoiceRequest) return true;

  const textTriggers = [
    'lista', 'checklist', 'tarefas', 'pendencias', 'agenda',
    'reuniao', 'horario', 'relatorio', 'dados', 'numeros'
  ];

  const hasTextTrigger = textTriggers.some(t => lowerUser.includes(t));
  if (hasTextTrigger) return false;

  const voiceTriggers = [
    'como voce esta', 'to bem', 'cansada', 'animada',
    'preocupada', 'feliz', 'triste', 'preciso conversar',
    'me ajuda', 'o que voce acha', 'sua opiniao'
  ];

  const hasVoiceTrigger = voiceTriggers.some(t => lowerUser.includes(t));
  if (hasVoiceTrigger) return true;

  return false;
}

