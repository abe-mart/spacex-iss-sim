"""Dock the Capsule: connect an autopilot or AI agent to the docking simulator.

    python -m hackathon.server               # terminal 1: start the local simulator server
    import hackathon.client as hackathon_client
    connection = hackathon_client.connect()  # in your autopilot: connect to that server

Request-reply over HTTP on this computer: request the latest telemetry, send thruster inputs.
Standard library only. C and C++ users can use the header-only clients in include/. See API.md.
"""

__version__ = "4.0"
