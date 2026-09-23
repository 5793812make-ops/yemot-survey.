// שלוחת "שאלון העדפות לעונת החורף" לימות המשיח.
// כל תשובה נשמרת כשורה בקובץ results/answers.csv על השרת עצמו.
// אין צורך במייל/SMTP בכלל - את הקובץ מורידים דרך /results (עם קוד סודי).
//
// לפני הרצה: npm install, ולמלא .env (ראו .env.example)

require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { YemotRouter } = require('yemot-router2');

const app = express();
app.use(express.urlencoded({ extended: true }));
const router = YemotRouter({
  printLog: false,
  defaults: { removeInvalidChars: true },
});

const RESULTS_DIR = path.join(__dirname, 'results');
const CSV_PATH = path.join(RESULTS_DIR, 'answers.csv');
const RESULTS_KEY = process.env.RESULTS_KEY; // "סיסמה" פשוטה לגישה לקובץ

if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR);

// בונה חותמת זמן בטוחה לשם קובץ (בלי נקודתיים/רווחים), לפי שעון ישראל
function timestampForFilename(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .formatToParts(date)
    .reduce((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day}_${parts.hour}-${parts.minute}-${parts.second}`;
}

const CSV_HEADERS = [
  'תאריך ושעה',
  'טלפון',
  'קובץ הקלטת שם',
  'גיל',
  'מתאמנת כיום',
  'מדריכה קודמת',
  'ממשיכה עם אותה מדריכה',
  'יום/שעה מועדפים',
  'סיבה מרכזית',
  'כוונת הרשמה לעונה',
  'קובץ משוב פתוח',
];

if (!fs.existsSync(CSV_PATH)) {
  fs.writeFileSync(CSV_PATH, '\uFEFF' + CSV_HEADERS.join(',') + '\n', 'utf8'); // \uFEFF כדי שאקסל יציג עברית נכון
}

// ---------------------------------------------------------------------------
// המרת שעה מספרית (למשל "19:30") להקראה טבעית בעברית ("שבע וחצי")
// ---------------------------------------------------------------------------
const HOUR_WORDS = {
  1: 'אחת', 2: 'שתיים', 3: 'שלוש', 4: 'ארבע', 5: 'חמש', 6: 'שש',
  7: 'שבע', 8: 'שמונה', 9: 'תשע', 10: 'עשר', 11: 'אחת עשרה', 12: 'שתים עשרה',
};

function timeToHebrewWords(timeStr) {
  const [hStr, mStr] = timeStr.split(':');
  let hour = parseInt(hStr, 10) % 12;
  if (hour === 0) hour = 12;
  const minutes = parseInt(mStr, 10);
  const hourWord = HOUR_WORDS[hour] || hStr;
  if (minutes === 30) return `${hourWord} וחצי`;
  if (minutes === 0) return hourWord;
  return `${hourWord} ו-${minutes}`;
}

// ---------------------------------------------------------------------------
// שאלה 5: קבוצות יום/שעה - בחירה דו-שלבית (קודם היום, אחר כך השעה)
// ---------------------------------------------------------------------------
const dayGroups = {
  1: { label: 'ראשון בערב עם שרה שמח', options: { 1: { time: '19:30' }, 2: { time: '20:30' }, 3: { time: '21:30' } } },
  2: { label: 'רביעי בערב עם רחלי מילצקי', options: { 1: { time: '19:30' }, 2: { time: '20:30' }, 3: { time: '21:30' } } },
  3: { label: 'שני בבוקר', options: { 1: { time: '08:30', extra: 'עם שרה שמח' }, 2: { time: '09:30', extra: 'עם תהילה' }, 3: { time: '10:30', extra: 'עם תהילה' } } },
  4: { label: 'רביעי בבוקר עם שרה שמח', options: { 1: { time: '08:30' }, 2: { time: '09:30' }, 3: { time: '10:30' } } },
  5: { label: 'שישי בבוקר עם תהילה', options: { 1: { time: '08:30' }, 2: { time: '09:30' }, 3: { time: '10:30' } } },
};

// ---------------------------------------------------------------------------
// נתיב השלוחה. יש להגדיר בהגדרות השלוחה בימות (api_url) לכתובת:
// https://הכתובת-שלך/survey
// השרת מגיב גם ל-GET וגם ל-POST, כך שלא משנה איך api_url_post מוגדר בימות.
// ---------------------------------------------------------------------------
router.get('/survey', surveyHandlerSafe);
router.post('/survey', surveyHandlerSafe);

async function surveyHandlerSafe(call) {
  try {
    await surveyHandler(call);
  } catch (err) {
    console.error('שגיאה בתוך השלוחה:', err);
    throw err;
  }
}

async function surveyHandler(call) {
  const a = {};
  const phoneForFile = (call.ApiPhone || 'unknown').replace(/[^0-9]/g, '');
  const fileTimestamp = timestampForFilename(new Date());

  // 1. הקלטת שם (עד 20 שניות)
  const nameFile = `name_${phoneForFile}_${fileTimestamp}`;
  await call.read(
    [{ type: 'text', data: 'הקליטי בבקשה את שמך, ולאחר ההקלטה הקישי סולמית לסיום' }],
    'record',
    { file_name: nameFile, max_length: '20' }
  );
  a.nameRecording = `${nameFile}.wav`;

  // 2. גיל
  a.age = await call.read(
    [{ type: 'text', data: 'מה גילך? הקישי את גילך בשתי ספרות' }],
    'tap',
    { min_digits: 2, max_digits: 2 }
  );

  // 3. האם מתעמלת כיום (+ ענף מותנה)
  const trainsNow = await call.read(
    [{ type: 'text', data: 'האם את מתעמלת אצלנו כיום? אם כן, הקישי אחת. אם לא, הקישי 2' }],
    'tap',
    { max_digits: 1, digits_allowed: [1, 2] }
  );
  a.trainsNow = trainsNow === '1' ? 'כן' : 'לא';

  if (trainsNow === '1') {
    const instructorMap = { 1: 'תהילה סיניסון', 2: 'שרה שמח', 3: 'רחלי מילצקי', 4: 'אחרת' };
    const instructor = await call.read(
      [{ type: 'text', data: 'מי המדריכה שהייתה לך? הקישי 1 תהילה סיניסון, 2 שרה שמח, 3 רחלי מילצקי, 4 אחרת' }],
      'tap',
      { max_digits: 1, digits_allowed: [1, 2, 3, 4] }
    );
    a.previousInstructor = instructorMap[instructor] || '(לא נענה)';
  } else {
    a.previousInstructor = '-';
  }

  // 4. האם מעוניינת להמשיך אצל אותה מדריכה
  const continueSame = await call.read(
    [{ type: 'text', data: 'האם את מעוניינת להמשיך אצל המדריכה שהייתה לך? אם כן, הקישי אחת. אם לא, ואת מעדיפה מדריכה אחרת, הקישי 2' }],
    'tap',
    { max_digits: 1, digits_allowed: [1, 2] }
  );
  a.continueSameInstructor = continueSame === '1' ? 'כן' : 'לא, מעדיפה מדריכה אחרת';

  // 5. יום ושעה מועדפים (שלב א: קבוצה, שלב ב: שעה בתוך הקבוצה)
  let groupChoiceText = 'אילו ימים ושעות מועדפים עלייך? ';
  Object.entries(dayGroups).forEach(([key, g]) => {
    groupChoiceText += `הקישי ${key} עבור ${g.label}. `;
  });
  const groupChoice = await call.read([{ type: 'text', data: groupChoiceText }], 'tap', {
    max_digits: 1,
    digits_allowed: [1, 2, 3, 4, 5],
  });
  const group = dayGroups[groupChoice];
  let timeChoiceText = 'בחרי שעה: ';
  Object.entries(group.options).forEach(([key, opt]) => {
    const spoken = timeToHebrewWords(opt.time) + (opt.extra ? ` ${opt.extra}` : '');
    timeChoiceText += `הקישי ${key} עבור ${spoken}. `;
  });
  const timeChoice = await call.read([{ type: 'text', data: timeChoiceText }], 'tap', {
    max_digits: 1,
    digits_allowed: [1, 2, 3],
  });
  const chosenSlot = group.options[timeChoice];
  a.preferredSlot = `${group.label} - ${chosenSlot.time}${chosenSlot.extra ? ' ' + chosenSlot.extra : ''}`;

  // 6. סיבה מרכזית
  const reasonMap = {
    1: 'מקצועיות, כושר ובריאות',
    2: 'נוחות השעות והקרבה לבית',
    3: 'חוויה אישית ואווירה קבוצתית',
  };
  const reason = await call.read(
    [{ type: 'text', data: 'מה הסיבה המרכזית שאת מגיעה להתעמל דווקא אצלנו? הקישי 1 מקצועיות כושר ובריאות, 2 נוחות השעות והקרבה לבית, 3 חוויה אישית ואווירה קבוצתית' }],
    'tap',
    { max_digits: 1, digits_allowed: [1, 2, 3] }
  );
  a.mainReason = reasonMap[reason] || '(לא נענה)';

  // 7. כוונה לסגור מנוי לעונה שלמה
  const subMap = {
    1: 'כן, בהחלט! ממשיכה לכל העונה',
    2: 'מתלבטת / לשוחח איתי',
    3: 'כרגע פחות מתאים להמשיך',
  };
  const sub = await call.read(
    [{ type: 'text', data: 'האם את מתכננת לסגור מנוי לעונה השלמה? הקישי 1 כן בהחלט, 2 מתלבטת ואשמח שייצרו איתי קשר, 3 כרגע פחות מתאים לי' }],
    'tap',
    { max_digits: 1, digits_allowed: [1, 2, 3] }
  );
  a.subscriptionIntent = subMap[sub] || '(לא נענה)';

  // 8. שאלה פתוחה - משוב על המדריכות (הקלטה)
  const feedbackFile = `feedback_${phoneForFile}_${fileTimestamp}`;
  await call.read(
    [{
      type: 'text',
      data: 'נשמח לשמוע את דעתך על המדריכות בלבד. ממי מהמדריכות את הכי נהנית, מה היית רוצה שתדייק או תשפר, ומה יגרום לך להישאר ולהתמיד. אנא הקליטי את תשובתך ולאחר מכן הקישי סולמית לסיום',
    }],
    'record',
    { file_name: feedbackFile, max_length: '120' }
  );
  a.feedbackRecording = `${feedbackFile}.wav`;

  // שמירת התשובות בקובץ CSV על השרת (במקום שליחת מייל)
  saveResultsToFile(call, a);

  call.id_list_message([{ type: 'text', data: 'תודה רבה על מילוי השאלון, להתראות' }]);
}

function csvEscape(value) {
  const str = String(value ?? '');
  return `"${str.replace(/"/g, '""')}"`;
}

function saveResultsToFile(call, a) {
  const phone = call.ApiPhone || call.ApiCallId || 'לא ידוע';
  const date = new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });

  const row = [
    date,
    phone,
    a.nameRecording,
    a.age,
    a.trainsNow,
    a.previousInstructor,
    a.continueSameInstructor,
    a.preferredSlot,
    a.mainReason,
    a.subscriptionIntent,
    a.feedbackRecording,
  ]
    .map(csvEscape)
    .join(',');

  fs.appendFileSync(CSV_PATH, row + '\n', 'utf8');
  console.log('תשובה נשמרה בקובץ:', CSV_PATH);
}

// -----------------------------------------------------------------
// בדיקה מהירה: כמה תשובות יש כרגע, בלי להוריד את הקובץ
// https://הכתובת-שלך/results/status?key=הקוד-הסודי-שלך
// -----------------------------------------------------------------
app.get('/results/status', (req, res) => {
  if (!RESULTS_KEY || req.query.key !== RESULTS_KEY) {
    return res.status(403).send('קוד גישה שגוי');
  }
  if (!fs.existsSync(CSV_PATH)) {
    return res.send('<h2>עדיין אין תשובות שמורות</h2>');
  }
  const lines = fs.readFileSync(CSV_PATH, 'utf8').trim().split('\n');
  const count = Math.max(lines.length - 1, 0); // פחות שורת הכותרות
  const lastRow = count > 0 ? lines[lines.length - 1] : null;
  const lastDate = lastRow ? lastRow.split(',')[0].replace(/"/g, '') : '-';

  res.send(`
    <html dir="rtl"><body style="font-family: sans-serif; padding: 2em;">
      <h2>סטטוס שאלון החורף</h2>
      <p><b>מספר תשובות שמורות כרגע:</b> ${count}</p>
      <p><b>תשובה אחרונה נקלטה ב:</b> ${lastDate}</p>
      <p><a href="/results?key=${RESULTS_KEY}">להורדת קובץ התוצאות המלא</a></p>
    </body></html>
  `);
});

// -----------------------------------------------------------------
// הורדת קובץ התוצאות: https://הכתובת-שלך/results?key=הקוד-הסודי-שלך
// -----------------------------------------------------------------
app.get('/results', (req, res) => {
  if (!RESULTS_KEY || req.query.key !== RESULTS_KEY) {
    return res.status(403).send('קוד גישה שגוי');
  }
  if (!fs.existsSync(CSV_PATH)) {
    return res.status(404).send('עדיין אין תוצאות');
  }
  res.download(CSV_PATH, 'תוצאות-סקר-חורף.csv');
});

app.use(router.asExpressRouter);
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Survey server running on port ${PORT}`));
