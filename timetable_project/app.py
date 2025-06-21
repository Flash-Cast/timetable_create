from flask import Flask, request, jsonify, render_template
from generator import TimetableGenerator

app = Flask(__name__)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/generate-timetable', methods=['POST'])
def generate_timetable_api():
    try:
        data = request.get_json()

        if not data:
            return jsonify({'success': False, 'message': 'リクエストデータがありません。'}), 400
        
        students = data.get('students')
        schedule_info = data.get('schedule_info')

        if not students or not schedule_info or not schedule_info.get('dates') or not schedule_info.get('slots_per_day'):
            return jsonify({'success': False, 'message': '生徒データまたはスケジュール情報が不足しています。'}), 400
        
        # --- ▼▼▼ タイムアウトをx秒に設定してジェネレータを呼び出す ▼▼▼ ---
        generator = TimetableGenerator(students, schedule_info, timeout=30)
        final_schedule = generator.generate()

        if final_schedule:
            return jsonify({'success': True, 'schedule': final_schedule})
        else:
            # --- ▼▼▼ タイムアウト時のメッセージを調整 ▼▼▼ ---
            return jsonify({
                'success': False, 
                'message': '時間内に条件を満たす時間割が見つかりませんでした。制約が厳しすぎるか、組み合わせが複雑すぎる可能性があります。条件を緩和して再度お試しください。'
            }), 400

    except Exception as e:
        print(f"エラー発生: {e}")
        return jsonify({'success': False, 'message': f'サーバーでエラーが発生しました: {e}'}), 500

if __name__ == '__main__':
    app.run(debug=True)