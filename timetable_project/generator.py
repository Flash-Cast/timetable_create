from ortools.sat.python import cp_model
import collections

class TimetableGenerator:
    def __init__(self, students, schedule_info, timeout=30):
        self.students_data = self._prepare_students_data(students)
        self.schedule_info = schedule_info
        self.all_lessons = self._create_lesson_list()
        self.timeout = timeout

        # データ整理
        self.all_student_names = list(self.students_data.keys())
        self.all_dates = self.schedule_info['dates']
        self.all_slots_per_day = self.schedule_info['slots_per_day']
        
        # (日付, コマ名) のタプルで全スロットのリストを作成
        self.all_time_slots = [
            (date, slot) for date in self.all_dates for slot in self.all_slots_per_day
        ]

    def _prepare_students_data(self, students):
        for name, data in students.items():
            total_lessons = sum(lesson['count'] for lesson in data['lessons'])
            data['total_lessons'] = total_lessons
        return students

    def _create_lesson_list(self):
        # OR-Tools
        lessons = []
        for student_name, data in self.students_data.items():
            for lesson_info in data['lessons']:
                for i in range(lesson_info['count']):
                    lessons.append({
                        'id': f"{student_name}_{lesson_info['name']}_{i+1}",
                        'student': student_name,
                        'lesson_name': lesson_info['name'],
                        'type': lesson_info['type']
                    })
        return lessons

    def generate(self):
        # 1. モデルの作成
        model = cp_model.CpModel()

        # 2. 変数の定義
        assigns = {}
        for i, lesson in enumerate(self.all_lessons):
            for j, time_slot in enumerate(self.all_time_slots):
                assigns[(i, j)] = model.NewBoolVar(f"assign_{i}_{j}")
        
        # --- 3. ハード制約 (絶対に守るルール) ---
        # [H1] 各授業は、ちょうど1つの時間帯に割り当てられる
        for i, lesson in enumerate(self.all_lessons):
            model.AddExactlyOne(assigns[(i, j)] for j, time_slot in enumerate(self.all_time_slots))

        # [H2] 1つの時間帯の定員を守る
        for j, time_slot in enumerate(self.all_time_slots):
            taimen_lessons = [assigns[(i, j)] for i, lesson in enumerate(self.all_lessons) if lesson['type'] in ['対面', '高校対面']]
            model.Add(sum(taimen_lessons) <= 4)
            koko_taimen_lessons_in_slot = [assigns[(i, j)] for i, lesson in enumerate(self.all_lessons) if lesson['type'] == '高校対面']
            has_koko_taimen = model.NewBoolVar(f'has_koko_taimen_slot_{j}')
            model.Add(sum(koko_taimen_lessons_in_slot) > 0).OnlyEnforceIf(has_koko_taimen)
            model.Add(sum(koko_taimen_lessons_in_slot) == 0).OnlyEnforceIf(has_koko_taimen.Not())
            model.Add(sum(taimen_lessons) <= 3).OnlyEnforceIf(has_koko_taimen)

        # [H3] 出勤不可日を守る
        for i, lesson in enumerate(self.all_lessons):
            student_info = self.students_data[lesson['student']]
            for j, time_slot in enumerate(self.all_time_slots):
                if time_slot[0] in student_info.get('unavailable_dates', []):
                    model.Add(assigns[(i, j)] == 0)

        # [H5] 各生徒は、1つの時間帯に最大1つの授業しか受けられない
        for student_name in self.all_student_names:
            for j, time_slot in enumerate(self.all_time_slots):
                lessons_for_student_in_slot = [assigns[(i, j)] for i, lesson in enumerate(self.all_lessons) if lesson['student'] == student_name]
                model.Add(sum(lessons_for_student_in_slot) <= 1)
        
        # --- 4. 補助変数とソフト制約のための変数を定義 ---
        lessons_per_student_day = {}
        has_lesson_on_day = {}
        # ▼▼▼ 今回のルールのために新しい補助変数を追加 ▼▼▼
        lesson_at_slot = {}

        for student_name in self.all_student_names:
            for date in self.all_dates:
                # 日ごとの変数
                daily_lesson_count_var = model.NewIntVar(0, len(self.all_slots_per_day), f'lessons_{student_name}_{date}')
                lessons_per_student_day[(student_name, date)] = daily_lesson_count_var
                has_lesson_var = model.NewBoolVar(f'has_lesson_{student_name}_{date}')
                has_lesson_on_day[(student_name, date)] = has_lesson_var
                daily_lessons_sum = sum(assigns[(i, k)] for i, lesson in enumerate(self.all_lessons) if lesson['student'] == student_name for k, time_slot in enumerate(self.all_time_slots) if time_slot[0] == date)
                model.Add(daily_lesson_count_var == daily_lessons_sum)
                model.Add(daily_lesson_count_var > 0).OnlyEnforceIf(has_lesson_var)
                model.Add(daily_lesson_count_var == 0).OnlyEnforceIf(has_lesson_var.Not())

                # スロットごとの変数
                for s_idx, slot_name in enumerate(self.all_slots_per_day):
                    lesson_at_slot_var = model.NewBoolVar(f'lesson_at_{student_name}_{date}_{slot_name}')
                    lesson_at_slot[(student_name, date, s_idx)] = lesson_at_slot_var
                    
                    time_slot_indices = [j for j, ts in enumerate(self.all_time_slots) if ts == (date, slot_name)]
                    if time_slot_indices:
                        lessons_in_slot_sum = sum(assigns[(i, time_slot_indices[0])] for i, l in enumerate(self.all_lessons) if l['student'] == student_name)
                        model.Add(lessons_in_slot_sum > 0).OnlyEnforceIf(lesson_at_slot_var)
                        model.Add(lessons_in_slot_sum == 0).OnlyEnforceIf(lesson_at_slot_var.Not())
                    else:
                        model.Add(lesson_at_slot_var == 0)


        # [H4] 総コマ数20以上の生徒は、授業がある日は必ず2コマ以上
        for student_name in self.all_student_names:
            if self.students_data[student_name]['total_lessons'] >= 20:
                for date in self.all_dates:
                    model.Add(lessons_per_student_day[(student_name, date)] >= 2).OnlyEnforceIf(has_lesson_on_day[(student_name, date)])
        
        # --- 5. 目的関数の設定 (ペナルティを最小化) ---
        penalties = []

        # [S1] 授業の均等分散
        for student_name in self.all_student_names:
            daily_counts = [lessons_per_student_day[(student_name, date)] for date in self.all_dates]
            min_lessons, max_lessons = model.NewIntVar(0, 10, ''), model.NewIntVar(0, 10, '')
            model.AddMinEquality(min_lessons, daily_counts)
            model.AddMaxEquality(max_lessons, daily_counts)
            spread = max_lessons - min_lessons
            penalties.append(spread)

        # [S2] 3日以上連続勤務へのペナルティ
        penalty_weight_3_days = 200
        for student_name in self.all_student_names:
            for i in range(len(self.all_dates) - 2):
                d1, d2, d3 = self.all_dates[i], self.all_dates[i+1], self.all_dates[i+2]
                if self.all_dates.index(d2) == self.all_dates.index(d1) + 1 and self.all_dates.index(d3) == self.all_dates.index(d2) + 1:
                    is_3_days_in_a_row = model.NewBoolVar(f'3day_{student_name}_{i}')
                    model.AddBoolAnd([has_lesson_on_day[(student_name, d1)], has_lesson_on_day[(student_name, d2)], has_lesson_on_day[(student_name, d3)]]).OnlyEnforceIf(is_3_days_in_a_row)
                    penalties.append(is_3_days_in_a_row * penalty_weight_3_days)
        
        # [S3] 2コマ以上空きへのペナルティ
        penalty_weight_2_slots_gap = 100
        for student_name in self.all_student_names:
            for date in self.all_dates:
                # 間に2コマ空くパターン (s, s+1, s+2, s+3) をチェック
                for s_idx in range(len(self.all_slots_per_day) - 3):
                    # パターン: [授業あり, 授業なし, 授業なし, 授業あり]
                    has_2_slot_gap = model.NewBoolVar(f'gap2_{student_name}_{date}_{s_idx}')
                    model.AddBoolAnd([
                        lesson_at_slot[(student_name, date, s_idx)],
                        lesson_at_slot[(student_name, date, s_idx + 3)],
                        lesson_at_slot[(student_name, date, s_idx + 1)].Not(),
                        lesson_at_slot[(student_name, date, s_idx + 2)].Not()
                    ]).OnlyEnforceIf(has_2_slot_gap)
                    penalties.append(has_2_slot_gap * penalty_weight_2_slots_gap)
        
        model.Minimize(sum(penalties))

        # 6. ソルバーの実行
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = self.timeout
        status = solver.Solve(model)

        # 7. 結果の解析と返却
        if status == cp_model.OPTIMAL or status == cp_model.FEASIBLE:
            print("すべてのルールを考慮した最適な解が見つかりました！")
            schedule = {date: {slot: [] for slot in self.all_slots_per_day} for date in self.all_dates}
            for i, lesson in enumerate(self.all_lessons):
                for j, time_slot in enumerate(self.all_time_slots):
                    if solver.Value(assigns[(i, j)]) == 1:
                        date, slot = time_slot
                        display_lesson = {
                            'student': lesson['student'],
                            'lesson_name': f"{lesson['lesson_name']}_{lesson['id'].split('_')[-1]}",
                            'type': lesson['type'] # この行を追加
                        }
                        schedule[date][slot].append(display_lesson)
                        break
            return schedule
        else:
            print("時間内に解を見つけることができませんでした。")
            return None