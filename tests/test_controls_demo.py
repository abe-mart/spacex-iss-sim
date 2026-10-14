import unittest
from starter.controls_demo import exercise_controls, wait_sim_seconds


class FakeSim:
    def __init__(self, practice=True, speed=1):
        self.practice, self.speed, self.clock, self.calls = practice, speed, 0, []

    def state(self):
        self.clock += self.speed * .5
        return {"practice": self.practice, "status": "flying", "time_s": self.clock}

    def translate_right(self, count=1): self.calls.append("translate_right")
    def translate_left(self, count=1): self.calls.append("translate_left")
    def commands(self, *commands): self.calls.extend(c["command"] for c in commands)


class ControlsTourTests(unittest.TestCase):
    def test_tour_exercises_controls_without_approaching_or_resetting(self):
        sim = FakeSim(speed=8)
        exercise_controls(sim)
        self.assertEqual(sim.calls, ["translate_right", "translate_left", "yaw_left", "roll_right", "yaw_right", "roll_left"])

    def test_tour_never_sends_commands_to_a_ranked_flight(self):
        sim = FakeSim(practice=False)
        exercise_controls(sim)
        self.assertEqual(sim.calls, [])

    def test_wait_uses_simulation_time(self):
        sim = FakeSim(speed=8)
        wait_sim_seconds(sim, 2)
        self.assertEqual(sim.clock, 8)
