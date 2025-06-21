document.addEventListener('DOMContentLoaded', () => {
    // --- 変数定義 ---
    const settingsForm = document.getElementById('settings-form');
    const studentsContainer = document.getElementById('students-container');
    const addStudentBtn = document.getElementById('add-student-btn');
    const saveBtn = document.getElementById('save-btn');
    const loadBtn = document.getElementById('load-btn');
    const studentFilterContainer = document.getElementById('student-filter-container');
    const summaryContainer = document.getElementById('summary-container');
    let studentIdCounter = 0;

    // --- 関数定義 ---

    /**
     * 現在のフォーム入力内容を収集し、バックエンド用のデータ形式に整形する関数
     */
    function collectDataFromForm() {
        const studentsData = {};
        const studentBoxes = document.querySelectorAll('.student-box');
        for (const studentBox of studentBoxes) {
            const studentName = studentBox.querySelector('.student-name').value.trim();
            if (!studentName) continue;

            const lessons = [];
            const lessonRows = studentBox.querySelectorAll('.lesson-row');
            for (const lessonRow of lessonRows) {
                const lessonName = lessonRow.querySelector('.lesson-name').value.trim();
                const lessonCount = lessonRow.querySelector('.lesson-count').value;
                const lessonType = lessonRow.querySelector('.lesson-type').value;
                if (lessonName && lessonCount) {
                    lessons.push({ name: lessonName, type: lessonType, count: parseInt(lessonCount) });
                }
            }
            const unavailableDates = studentBox.querySelector('.unavailable-dates').value.split(',').map(d => d.trim()).filter(d => d);
            studentsData[studentName] = { lessons: lessons, unavailable_dates: unavailableDates };
        }
        const scheduleData = {
            dates: document.getElementById('schedule-dates').value.split(',').map(d => d.trim()).filter(d => d),
            slots_per_day: document.getElementById('schedule-slots').value.split(',').map(s => s.trim()).filter(s => s)
        };
        return { students: studentsData, schedule_info: scheduleData };
    }

    /**
     * ファイルから読み込んだデータでフォームを再構築する関数
     * @param {object} data 読み込んだJSONデータ
     */
    function populateForm(data) {
        document.getElementById('schedule-dates').value = data.schedule_info.dates.join(', ');
        document.getElementById('schedule-slots').value = data.schedule_info.slots_per_day.join(', ');
        studentsContainer.innerHTML = '';
        studentIdCounter = 0;
        for (const studentName in data.students) {
            const studentData = data.students[studentName];
            addStudentBtn.click();
            const newStudentBox = document.getElementById(`student-${studentIdCounter}`);
            newStudentBox.querySelector('.student-name').value = studentName;
            newStudentBox.querySelector('.unavailable-dates').value = studentData.unavailable_dates.join(', ');
            const lessonsContainer = newStudentBox.querySelector('.lessons-container');
            const addLessonBtn = newStudentBox.querySelector('.add-lesson-btn');
            studentData.lessons.forEach(lesson => {
                addLessonBtn.click();
                const newLessonRow = lessonsContainer.lastElementChild;
                newLessonRow.querySelector('.lesson-name').value = lesson.name;
                newLessonRow.querySelector('.lesson-count').value = lesson.count;
                newLessonRow.querySelector('.lesson-type').value = lesson.type;
            });
        }
    }

    /**
     * 生成された時間割テーブルを描画する関数
     * @param {object} schedule スケジュールデータ
     * @param {string[]} slots 1日のコマ名の配列
     */
    function displaySchedule(schedule, slots) {
        const resultArea = document.getElementById('result-area');
        let tableHtml = '<table><thead><tr><th>日付</th>';
        slots.forEach(slot => { tableHtml += `<th>${slot}</th>`; });
        tableHtml += '</tr></thead><tbody>';

        const allStudents = new Set();

        Object.keys(schedule).sort().forEach(date => {
            tableHtml += `<tr><td>${date}</td>`;
            slots.forEach(slot => {
                const lessons = schedule[date][slot];
                lessons.forEach(l => allStudents.add(l.student));

                const lessonStr = lessons.map(l => {
                    let baseName = l.lesson_name;
                    const lastUnderscoreIndex = l.lesson_name.lastIndexOf('_');
                    if (lastUnderscoreIndex > -1 && lastUnderscoreIndex < l.lesson_name.length - 1) {
                        const suffix = l.lesson_name.substring(lastUnderscoreIndex + 1);
                        if (!isNaN(parseInt(suffix))) {
                            baseName = l.lesson_name.substring(0, lastUnderscoreIndex);
                        }
                    }
                    const typeClass = `lesson-type-${l.type}`;
                    return `<span class="lesson-badge ${typeClass}" data-student="${l.student}">${l.student}(${baseName})</span>`;
                }).join('');
                
                tableHtml += `<td>${lessonStr}</td>`;
            });
            tableHtml += '</tr>';
        });

        tableHtml += '</tbody></table>';
        resultArea.innerHTML = tableHtml;

        studentFilterContainer.innerHTML = '';
        let filterHtml = '<button class="filter-btn active" data-student-filter="all">全員表示</button>';
        Array.from(allStudents).sort().forEach(student => {
            filterHtml += `<button class="filter-btn" data-student-filter="${student}">${student}</button>`;
        });
        studentFilterContainer.innerHTML = filterHtml;
    }

    /**
     * 時間割の統計情報を計算して表示する関数
     * @param {object} schedule スケジュールデータ
     */
    function displaySummary(schedule) {
        const studentTotals = {};
        const dailyAttributeTotals = {};
        for (const date in schedule) {
            dailyAttributeTotals[date] = { '対面': 0, 'SS': 0, '高校対面': 0 };
            for (const slot in schedule[date]) {
                for (const lesson of schedule[date][slot]) {
                    studentTotals[lesson.student] = (studentTotals[lesson.student] || 0) + 1;
                    if (lesson.type in dailyAttributeTotals[date]) {
                        dailyAttributeTotals[date][lesson.type]++;
                    }
                }
            }
        }
        let summaryHtml = '<h3>統計情報</h3>';
        summaryHtml += '<div class="summary-section">';
        summaryHtml += '<div><h4>生徒ごとの総コマ数</h4><ul>';
        Object.keys(studentTotals).sort().forEach(student => {
            summaryHtml += `<li>${student}: ${studentTotals[student]}コマ</li>`;
        });
        summaryHtml += '</ul></div>';
        summaryHtml += '<div><h4>日付ごとのコマ数</h4><ul>';
        Object.keys(dailyAttributeTotals).sort().forEach(date => {
            const totals = dailyAttributeTotals[date];
            const details = Object.keys(totals).filter(type => totals[type] > 0).map(type => `${type}: ${totals[type]}`).join(', ');
            if (details) {
                summaryHtml += `<li><strong>${date}:</strong> ${details}</li>`;
            }
        });
        summaryHtml += '</ul></div>';
        summaryHtml += '</div>';
        summaryContainer.innerHTML = summaryHtml;
    }

    // --- イベントリスナー設定 ---

    // 「生徒を追加」ボタン
    addStudentBtn.addEventListener('click', () => {
        studentIdCounter++;
        const studentId = `student-${studentIdCounter}`;
        const studentHtml = `<div class="student-box" id="${studentId}"><div class="student-header"><input type="text" class="student-name" placeholder="生徒名" required><button type="button" class="remove-student-btn small-btn">×</button></div><input type="text" class="unavailable-dates" placeholder="授業を受けられない日（カンマ区切り）"><div class="lessons-container"></div><button type="button" class="add-lesson-btn small-btn">＋ 科目を追加</button></div>`;
        studentsContainer.insertAdjacentHTML('beforeend', studentHtml);
    });

    // 「科目追加」「生徒削除」など（イベント移譲）
    studentsContainer.addEventListener('click', (event) => {
        if (event.target.classList.contains('remove-student-btn')) event.target.closest('.student-box').remove();
        if (event.target.classList.contains('add-lesson-btn')) {
            const lessonsContainer = event.target.previousElementSibling;
            const lessonHtml = `<div class="lesson-row"><input type="text" class="lesson-name" placeholder="科目名" required><input type="number" class="lesson-count" placeholder="コマ数" min="1" required><select class="lesson-type"><option value="対面">対面</option><option value="SS">SS</option><option value="高校対面">高校対面</option></select><button type="button" class="remove-lesson-btn">×</button></div>`;
            lessonsContainer.insertAdjacentHTML('beforeend', lessonHtml);
        }
        if (event.target.classList.contains('remove-lesson-btn')) event.target.closest('.lesson-row').remove();
    });

    // 「時間割を作成」ボタン（メインの生成処理）
    settingsForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const { students, schedule_info } = collectDataFromForm();
        if (Object.keys(students).length === 0) {
            alert('生徒を1人以上登録してください。');
            return;
        }
        const loadingDiv = document.getElementById('loading');
        const resultArea = document.getElementById('result-area');
        summaryContainer.innerHTML = '';
        studentFilterContainer.innerHTML = '';
        loadingDiv.style.display = 'block';
        resultArea.innerHTML = '';

        try {
            const response = await fetch('/generate-timetable', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ students, schedule_info }),
            });
            const result = await response.json();
            if (response.ok && result.success) {
                displaySchedule(result.schedule, schedule_info.slots_per_day);
                displaySummary(result.schedule);
            } else {
                resultArea.innerHTML = `<p class="error-message">エラー: ${result.message || '不明なエラーが発生しました。'}</p>`;
            }
        } catch (error) {
            console.error('通信エラー:', error);
            resultArea.innerHTML = `<p class="error-message">通信エラーが発生しました。サーバーのログやコンソールを確認してください。</p>`;
        } finally {
            loadingDiv.style.display = 'none';
        }
    });

    // 「設定を保存」ボタン
    saveBtn.addEventListener('click', () => {
        const data = collectDataFromForm();
        if (Object.keys(data.students).length === 0) {
            alert('保存するデータがありません。');
            return;
        }
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'schedule_data.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    // 「設定を読込」ボタン
    loadBtn.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (event) => {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    if (data.students && data.schedule_info) {
                        populateForm(data);
                    } else {
                        alert('無効なファイル形式です。');
                    }
                } catch (err) {
                    alert('ファイルの読み込みに失敗しました。');
                    console.error(err);
                }
            };
            reader.readAsText(file);
        };
        input.click();
    });

    // 生徒フィルターのクリックイベント
    studentFilterContainer.addEventListener('click', (event) => {
        if (!event.target.classList.contains('filter-btn')) return;
        const filterTarget = event.target.dataset.studentFilter;
        studentFilterContainer.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
        event.target.classList.add('active');
        document.querySelectorAll('.lesson-badge').forEach(badge => {
            badge.classList.remove('dimmed');
            if (filterTarget !== 'all' && badge.dataset.student !== filterTarget) {
                badge.classList.add('dimmed');
            }
        });
    });
});