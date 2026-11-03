"""Offline parsing must preserve intent, quantities and the selected method."""
import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from natural_agent import parse_simulation_intent


class NaturalParser(unittest.TestCase):
    def reject(self, text):
        result = parse_simulation_intent(text)
        self.assertEqual(result['type'], 'unsupported', result)
        self.assertIn('未启动计算', result['reason'])
        return result

    def test_chinese_units_are_converted_for_rays(self):
        plan = parse_simulation_intent('请仿真等声速射线，水深200米，声源20米，距离10千米，掠射角15度和30度')
        self.assertEqual(plan['type'], 'ray')
        for key, expected in [('water_depth_m', 200), ('source_depth_m', 20), ('range_max_km', 10), ('angles_deg', [15, 30])]:
            self.assertEqual(plan[key], expected)
        other = parse_simulation_intent('请计算等声速声线，水深0.2km，源深2000厘米，距离10000米，声速1500米每秒，掠射角0度，向下发射')
        self.assertEqual(other['water_depth_m'], 200);self.assertEqual(other['source_depth_m'], 20)
        self.assertEqual(other['range_max_km'], 10);self.assertEqual(other['angles_deg'], [0]);self.assertEqual(other['launch_direction'], 'down')

    def test_munk_units_intervals_and_explicit_sampling(self):
        plan = parse_simulation_intent('请用KRAKEN仿真Munk声场，频率0.05kHz和0.1kHz，源深0.5公里和1公里，接收深度100000厘米，距离1000米至5千米，距离点数51，深度点数51')
        self.assertEqual(plan['type'], 'kraken', plan)
        self.assertEqual(plan['frequencies_hz'], [50, 100]);self.assertEqual(plan['source_depths_m'], [500, 1000])
        self.assertEqual(plan['receiver_depth_m'], 1000);self.assertEqual(plan['range_min_km'], 1);self.assertEqual(plan['range_max_km'], 5)
        self.assertEqual(plan['range_points'], 51);self.assertEqual(plan['depth_points'], 51)

    def test_questions_and_negations_are_not_execution(self):
        for text in ['请问如何运行KRAKEN仿真？', '能不能解释如何仿真Munk？', '帮我看看怎么运行KRAKEN仿真', '不要运行仿真，只说明参数', '什么是射线？']:
            with self.subTest(text=text):self.assertIsNone(parse_simulation_intent(text))

    def test_shallow_or_custom_environment_is_not_replaced_with_munk(self):
        for text in ['请模拟水深100m的浅海声场，频率100Hz，源深50m', '请用KRAKEN模拟水深2000米的声场', '请模拟Pekeris声场', '请模拟南海实时声场', '请计算Munk声场，声速1500m/s']:
            with self.subTest(text=text):self.reject(text)

    def test_invalid_explicit_values_never_become_defaults(self):
        for text in ['请仿真Munk声场，频率500Hz', '请仿真Munk声场，频率50Hz和500Hz', '请仿真Munk声场，源深-10m', '请仿真Munk声场，接收深度5000米', '请仿真Munk声场，距离200km', '请仿真Munk声场，频率50', '请仿真射线，水深200英尺', '请仿真射线，掠射角90度', '请仿真Munk声场，距离点数5000', '请仿真Munk的2GHz声场', '请仿真Munk声场，频率50GHz和100Hz', '请仿真Munk声场，频率50至100Hz', '请仿真射线，水深200m/s']:
            with self.subTest(text=text):self.reject(text)

    def test_selected_solver_and_ray_physics_are_preserved(self):
        for text in ['请用BELLHOP仿真射线', '请用KRAKENC仿真Munk声场', '请用RAM模拟声场', '请计算Munk声道内的梯度折射声线', '请用KRAKEN画声线', '请仿真射线并给出传播损失']:
            with self.subTest(text=text):self.reject(text)


if __name__ == '__main__':unittest.main()
