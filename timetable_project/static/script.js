document.addEventListener('DOMContentLoaded', () => {
    // --- 変数定義 ---
    const settingsForm = document.getElementById('settings-form');
    const studentsContainer = document.getElementById('students-container');
    const addStudentBtn = document.getElementById('add-student-btn');
    const saveBtn = document.getElementById('save-btn');
    const loadBtn = document.getElementById('load-btn');
    const studentFilterContainer = document.getElementById('student-filter-container');
    const summaryContainer = document.getElementById('summary-container');
    const exportCsvBtn = document.getElementById('export-csv-btn');
    const studentSearchInput = document.getElementById('student-search-input'); 
    let studentIdCounter = 0;
    let latestSchedule = null;
    
    // Flatpickrを日付入力欄（ID: schedule-dates）に適用
    flatpickr("#schedule-dates", {
        mode: "multiple",      // 複数日の選択を許可
        dateFormat: "Y-m-d",   // 日付のフォーマットを指定 (例: 2025-07-22)
        locale: "ja",          // 表示を日本語化
        onChange: function(selectedDates, dateStr, instance) {
            // カンマ区切りではなく、", " で区切るように整形
            instance.input.value = selectedDates.map(date => instance.formatDate(date, "Y-m-d")).join(', ');
        }
    });

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

    /**
     * スケジュールオブジェクトをCSV文字列に変換する関数
     * @param {object} schedule スケジュールデータ
     * @param {string[]} slots 1日のコマ名の配列
     * @returns {string} CSV形式の文字列
     */
    function convertScheduleToCsv(schedule, slots) {
        // ヘッダー行を作成
        const header = ['日付', ...slots];
        const rows = [header.join(',')];

        // データ行を作成
        Object.keys(schedule).sort().forEach(date => {
            const row = [date];
            slots.forEach(slot => {
                const lessons = schedule[date][slot];
                // 1つのセルに複数ある場合は改行で区切る
                const cellContent = lessons.map(l => {
                    let baseName = l.lesson_name;
                    const lastUnderscoreIndex = l.lesson_name.lastIndexOf('_');
                    if (lastUnderscoreIndex > -1) {
                        const suffix = l.lesson_name.substring(lastUnderscoreIndex + 1);
                        if (!isNaN(parseInt(suffix))) {
                            baseName = l.lesson_name.substring(0, lastUnderscoreIndex);
                        }
                    }
                    return `${l.student}(${baseName})`;
                }).join('\n'); // Excelでセル内改行になるようLF(\n)を使用

                // セル内に改行やカンマが含まれる可能性があるので、ダブルクォートで囲む
                row.push(`"${cellContent.replace(/"/g, '""')}"`);
            });
            rows.push(row.join(','));
        });

        // BOMを先頭に付けてExcelでの文字化けを防ぐ
        return '\uFEFF' + rows.join('\n');
    }

    // --- イベントリスナー設定 ---

    // ▼▼▼ 生徒検索ボックスの入力
    studentSearchInput.addEventListener('input', (event) => {
        const searchTerm = event.target.value.toLowerCase();
        const studentButtons = studentFilterContainer.querySelectorAll('.filter-btn');

        studentButtons.forEach(button => {
            // 「全員表示」ボタンは常に表示
            if (button.dataset.studentFilter === 'all') {
                return;
            }

            const studentName = button.textContent.toLowerCase();
            if (studentName.includes(searchTerm)) {
                button.style.display = 'inline-block'; // 一致すれば表示
            } else {
                button.style.display = 'none'; // 一致しなければ非表示
            }
        });
    });

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

        // 処理開始時にボタンを無効化
        exportCsvBtn.disabled = true;
        latestSchedule = null;

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
                // 成功時に結果を保存し、CSV保存ボタンを有効化
                latestSchedule = result.schedule;
                exportCsvBtn.disabled = false;

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

    // ▼▼▼ CSVエクスポートボタンの処理 ▼▼▼
    exportCsvBtn.addEventListener('click', () => {
        if (!latestSchedule) {
            alert('エクスポートする時間割がありません。');
            return;
        }
        const scheduleData = collectDataFromForm();
        const csvContent = convertScheduleToCsv(latestSchedule, scheduleData.schedule_info.slots_per_day);
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'schedule.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
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