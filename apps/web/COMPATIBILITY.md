# Server compatibility

Build both server images and the CLI, engine and agent plugins from the same
source revision. This checkout uses the `nodrail.com/v1alpha1` resource format
and the `/api/v1` control plane.

Before updating a fleet, verify that the intended host can publish or pull the
locked policy and report an allowed and a denied call to that server.
