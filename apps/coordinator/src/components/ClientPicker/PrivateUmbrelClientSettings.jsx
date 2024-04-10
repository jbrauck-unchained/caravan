import React from "react";
import PropTypes from "prop-types";

// Components
import { Grid, TextField, Button, FormHelperText, Box } from "@mui/material";

const PrivateUmbrelClientSettings = ({
  handleUrlChange,
  handleUsernameChange,
  handlePasswordChange,
  client,
  urlError,
  usernameError,
  passwordError,
  privateNotes,
  connectSuccess,
  connectError,
  testConnection,
}) => (
  <div>
    <p>
      This version of caravan is configured to work with Umbrel. A prerequisite
      is to have the bitcoin node installed and fully synced.
    </p>
    <p>
      <small>
        {
          "Note: Upon importing a wallet configuration, you will need to import address with the 'rescan' option enbaled. The wallet will then be rescanned. This may take a long time depending on the number of transactions in the wallet."
        }
      </small>
    </p>
    <form>
      <Grid container direction="column" spacing={1}>
        <Grid item>
          <TextField
            fullWidth
            label="URL"
            value={client.url}
            variant="standard"
            onChange={handleUrlChange}
            error={urlError !== ""}
            helperText={urlError}
          />
        </Grid>

        <Grid item>
          <TextField
            id="bitcoind-username"
            fullWidth
            label="Username"
            value={client.username}
            variant="standard"
            onChange={handleUsernameChange}
            error={usernameError !== ""}
            helperText={usernameError}
          />
        </Grid>

        <Grid item>
          <TextField
            id="bitcoind-password"
            fullWidth
            type="password"
            label="Password"
            value={client.password}
            variant="standard"
            onChange={handlePasswordChange}
            error={passwordError !== ""}
            helperText={passwordError}
          />
        </Grid>
        <Grid item>
          <Box mt={1}>
            <Button variant="contained" onClick={testConnection}>
              Test Connection
            </Button>
          </Box>
          <Box mt={2}>
            {connectSuccess && (
              <FormHelperText>Connection Success!</FormHelperText>
            )}
            {connectError !== "" && (
              <FormHelperText error>{connectError}</FormHelperText>
            )}
          </Box>
        </Grid>
      </Grid>
    </form>
    {privateNotes}
  </div>
);

PrivateUmbrelClientSettings.propTypes = {
  client: PropTypes.shape({
    url: PropTypes.string.isRequired,
    username: PropTypes.string.isRequired,
    password: PropTypes.string.isRequired,
  }).isRequired,
  handleUrlChange: PropTypes.func.isRequired,
  handleUsernameChange: PropTypes.func.isRequired,
  handlePasswordChange: PropTypes.func.isRequired,
  testConnection: PropTypes.func.isRequired,
  urlError: PropTypes.string,
  usernameError: PropTypes.string,
  passwordError: PropTypes.string,
  privateNotes: PropTypes.node,
  connectSuccess: PropTypes.bool.isRequired,
  connectError: PropTypes.string.isRequired,
};

PrivateUmbrelClientSettings.defaultProps = {
  urlError: "",
  usernameError: "",
  passwordError: "",
  privateNotes: React.createElement("span"),
};

export default PrivateUmbrelClientSettings;
